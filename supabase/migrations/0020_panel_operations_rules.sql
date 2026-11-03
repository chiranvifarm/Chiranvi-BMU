-- =====================================================================================================
-- 0020 · Nothing kept in the browser (round 2): the panel's operations lists in panel_records
--   No new tables: the panel's own orders, deliveries, routes, delivery agents, the staff list, scheduled
--   reports and the Delivery Panel's day are more rows in panel_records (0019), by page ("module"), under the
--   same Roles & permissions rules. This only adjusts those rules for the delivery agents:
--   1. A delivery, a route and an agent carry their agent's login number (owner_mobile), so an agent reads
--      only their own stops, their own route and their own agent card (the rule "or own" of 0019).
--   2. An agent may mark their own stops along (Out for delivery, Delivered, Missed) and nothing else on
--      them; staff with Deliveries → Edit change anything.
--   3. Staff who may change a list may also hand a delivery / route / agent card to another agent (its
--      owner_mobile changes with it); nobody else can move a record.
--   4. A day's sample deliveries are copied in once per day; the older days' samples are removed then (they
--      are made up again from the date when an earlier day is looked at), so samples never pile up.
-- Safe to run again.
-- =====================================================================================================


-- 1–2. An agent marks their own stops along ----------------------------------------------------------
drop policy if exists "Staff edit or own day" on public.panel_records;
create policy "Staff edit or own day" on public.panel_records for update
  using (module = any((select public.my_panel_modules('edit'))::text[])
         or (module = 'agent-days' and owner_mobile = (select public.current_mobile()))
         or (module = 'deliveries' and owner_mobile = (select public.current_mobile())
             and (select public.current_staff_role()) = 'delivery-agent'))
  with check (module = any((select public.my_panel_modules('edit'))::text[])
              or (module = 'agent-days' and owner_mobile = (select public.current_mobile()))
              or (module = 'deliveries' and owner_mobile = (select public.current_mobile())
                  and (select public.current_staff_role()) = 'delivery-agent'));


-- 2–3. What each person may change on a record ----------------------------------------------------
create or replace function public.guard_panel_record()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  may_edit boolean := new.module = any(public.my_panel_modules(case when tg_op = 'INSERT' then 'create' else 'edit' end));
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if tg_op = 'UPDATE' and (new.module <> old.module or new.id <> old.id) then
    raise exception 'This record can''t be moved';
  end if;
  -- Handing a delivery, route or agent card to another agent: only staff who may change that list
  if tg_op = 'UPDATE' and new.owner_mobile is distinct from old.owner_mobile
     and not (may_edit and new.module in ('deliveries', 'routes', 'agents')) then
    raise exception 'This record can''t be moved';
  end if;
  -- An agent on their own stop: only its step (and when it was delivered)
  if tg_op = 'UPDATE' and new.module = 'deliveries' and not may_edit then
    if (new.data - 'status' - 'deliveredAt') is distinct from (old.data - 'status' - 'deliveredAt')
       or coalesce(new.data ->> 'status', '') not in ('Out for delivery', 'Delivered', 'Missed') then
      raise exception 'Only the stop''s step can be changed';
    end if;
  end if;
  if tg_op = 'INSERT' and new.module = 'pause-requests' and not may_edit then
    new.data := (new.data - 'decidedBy')
      || jsonb_build_object('status', 'Pending', 'requestedAt', to_jsonb(now()), 'customerMobile', new.owner_mobile);
    new.is_sample := false;
  end if;
  if tg_op = 'INSERT' and new.module = 'agent-days' and not may_edit then
    new.is_sample := false;
  end if;
  return new;
end;
$$;


-- 4. A day's sample deliveries, once per day (older days' samples removed) ---------------------------
create or replace function public.seed_panel_records(seed_key text, module text, records jsonb)
returns boolean
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.has_permission(public.panel_permission_of(module), 'view') then
    return false;
  end if;
  if jsonb_typeof(records) is distinct from 'array' or jsonb_array_length(records) > 5000 then
    raise exception 'Too many records';
  end if;
  insert into public.panel_seeds (seed_key) values (seed_panel_records.seed_key) on conflict do nothing;
  if not found then
    return false;
  end if;
  -- A new day's sample deliveries: the earlier days' samples go (real deliveries stay)
  if seed_panel_records.module = 'deliveries' then
    delete from public.panel_records r
    where r.module = 'deliveries' and r.is_sample
      and coalesce(r.data ->> 'date', '') < coalesce((records -> 0 -> 'data' ->> 'date'), '');
  end if;
  insert into public.panel_records (module, id, data, owner_mobile, is_sample, sort_order)
  select seed_panel_records.module, r.value ->> 'id', r.value -> 'data',
         case when coalesce(r.value ->> 'ownerMobile', '') ~ '^\d{10}$' then r.value ->> 'ownerMobile' end,
         coalesce((r.value ->> 'isSample')::boolean, true), (r.ordinality - 1)::integer
  from jsonb_array_elements(records) with ordinality as r(value, ordinality)
  where coalesce(r.value ->> 'id', '') <> '' and jsonb_typeof(r.value -> 'data') = 'object'
  on conflict do nothing;
  return true;
end;
$$;

-- Today's deliveries are read by date
create index if not exists panel_records_delivery_date_idx on public.panel_records ((data ->> 'date')) where module = 'deliveries';
