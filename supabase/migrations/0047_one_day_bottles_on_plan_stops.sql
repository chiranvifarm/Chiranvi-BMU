-- =====================================================================================================
-- 0047 · A plan's stop carries one day's bottles
--   An older stop could hold the whole plan's bottles (180), and create_todays_plan_stops() copied it, so the agent
--   saw Jersey Milk × 180. Each day's stop now carries the plan's bottles per day. Unfinished plan stops are corrected.
--   No new table.
-- Safe to run again.
-- =====================================================================================================

create or replace function private.one_day_items(items jsonb, plan_subscription jsonb)
returns jsonb
language sql immutable
as $$
  select coalesce(jsonb_agg(item || jsonb_build_object('quantity', coalesce((plan_subscription ->> 'bottlesPerDay')::integer, 1)) order by position), '[]'::jsonb)
    from jsonb_array_elements(coalesce(items, '[]'::jsonb)) with ordinality as rows (item, position);
$$;

create or replace function public.create_todays_plan_stops()
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  today_key text := to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD');
  plan public.orders;
  last_stop public.panel_records;
  new_id text;
  added integer := 0;
begin
  if not coalesce((select public.current_staff_role()) = 'delivery-agent' or (select public.has_permission('deliveries', 'view')), false) then
    raise exception 'You can''t see the deliveries' using errcode = '42501';
  end if;

  for plan in
    select * from public.orders o
     where o.subscription is not null and o.status <> 'cancelled' and not (o.subscription ? 'extendsOrderId')
  loop
    -- The plan's agent: the one on its last stop. No stop yet: no agent has been given
    select * into last_stop from public.panel_records d
     where d.module = 'deliveries' and d.owner_mobile is not null and d.data ->> 'orderNumber' = '#' || plan.order_number
     order by d.data ->> 'date' desc, d.created_at desc
     limit 1;
    continue when last_stop.id is null;

    update public.panel_records
       set data = data || '{"status": "Missed"}'::jsonb
     where module = 'deliveries' and data ->> 'orderNumber' = '#' || plan.order_number
       and data ->> 'date' < today_key and data ->> 'status' in ('Pending', 'Out for delivery');

    continue when today <= (plan.placed_at at time zone 'Asia/Kolkata')::date or today > private.plan_last_day(plan);
    continue when exists (
      select 1 from public.panel_records p
       where p.module = 'pause-requests' and p.data ->> 'status' = 'Approved' and p.data ->> 'websiteOrderId' = plan.order_number
         and today >= ((p.data ->> 'pauseFrom')::timestamptz at time zone 'Asia/Kolkata')::date
         and today < ((p.data ->> 'resumeOn')::timestamptz at time zone 'Asia/Kolkata')::date);
    continue when exists (
      select 1 from public.panel_records d
       where d.module = 'deliveries' and d.data ->> 'orderNumber' = '#' || plan.order_number and d.data ->> 'date' = today_key);

    new_id := 'D-' || replace(today_key, '-', '') || '-' || plan.order_number;
    insert into public.panel_records (module, id, data, owner_mobile)
    values ('deliveries', new_id,
            (last_stop.data - 'history' - 'transferRequest' - 'deliveredAt' - 'proof')
              || jsonb_build_object('id', new_id, 'date', today_key, 'status', 'Pending', 'isSubscription', true,
                                    'items', private.one_day_items(last_stop.data -> 'items', plan.subscription)),
            last_stop.owner_mobile)
    on conflict do nothing;
    if found then
      added := added + 1;
    end if;
  end loop;
  return added;
end;
$$;

update public.panel_records d
   set data = d.data || jsonb_build_object('items', private.one_day_items(d.data -> 'items', o.subscription))
  from public.orders o
 where d.module = 'deliveries' and '#' || o.order_number = d.data ->> 'orderNumber' and o.subscription is not null
   and d.data ->> 'status' in ('Pending', 'Out for delivery');

revoke execute on function private.one_day_items(jsonb, jsonb) from public, anon, authenticated;
