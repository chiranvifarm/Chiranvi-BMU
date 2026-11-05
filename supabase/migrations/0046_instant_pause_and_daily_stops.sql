-- =====================================================================================================
-- 0046 · Instant pause, Unpause, and a stop for each plan every day
--   Pause: a customer pauses a plan themselves, for 1 to 22 days, with no approval. Pause and Unpause work from
--   9 AM to 9 PM in India and count from the next day. The panel's Pause requests page only shows them.
--   pause_my_plan(): saves it already Approved. A customer can no longer add a request any other way.
--   unpause_my_plan(): a pause already running ends tomorrow (its resume day moves up); one not started yet is
--   called off (status Unpaused). The plan's end date follows: only the days really paused are added.
--   create_todays_plan_stops(): every running plan gets today's stop, for the agent of its last stop, so the milk
--   is on the agent's list each morning. No stop on a paused day. A plan's unfinished stop from an earlier day
--   becomes Missed (that morning has gone). Run when an agent or the panel opens today's deliveries; safe to
--   run many times.
--   Waiting pause requests are cleared (status Unpaused): nobody approves them any more.
--   No new table.
-- Safe to run again.
-- =====================================================================================================

-- A customer pauses through pause_my_plan() only
create or replace function public.guard_pause_request()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.module <> 'pause-requests' or current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if new.data ->> 'kind' = 'skip' then
    raise exception 'Skipping a delivery is not available. You can pause your subscription';
  end if;
  if new.module = any(public.my_panel_modules('create')) then
    return new;
  end if;
  raise exception 'Use Pause subscription on your Subscription page';
end;
$$;


-- All of a plan's approved pauses, in days, on its order
create or replace function private.set_plan_paused_days(plan_order text)
returns void
language sql
set search_path = public
as $$
  update public.orders
     set subscription = subscription || jsonb_build_object('pausedDays', (
           select coalesce(sum(((p.data ->> 'resumeOn')::timestamptz at time zone 'Asia/Kolkata')::date
                               - ((p.data ->> 'pauseFrom')::timestamptz at time zone 'Asia/Kolkata')::date), 0)
             from public.panel_records p
            where p.module = 'pause-requests' and p.data ->> 'status' = 'Approved'
              and plan_order in (p.data ->> 'websiteOrderId', p.data ->> 'planOrderId')))
   where order_number = plan_order and subscription is not null;
$$;

-- The last delivery day of a plan: its days, its paused days and its paid extensions
create or replace function private.plan_last_day(plan public.orders)
returns date
language sql stable
set search_path = public
as $$
  select (plan.placed_at at time zone 'Asia/Kolkata')::date
         + coalesce((plan.subscription ->> 'days')::integer, 0)
         + coalesce((plan.subscription ->> 'pausedDays')::integer, 0)
         + coalesce((select sum((e.subscription ->> 'days')::integer)::integer from public.orders e
                      where e.subscription ->> 'extendsOrderId' = plan.order_number and e.status <> 'cancelled'
                        and e.payment_status in ('paid', 'not_charged')), 0);
$$;

-- 9 AM to 9 PM in India
create or replace function private.check_pause_hours()
returns void
language plpgsql stable
as $$
begin
  if extract(hour from (now() at time zone 'Asia/Kolkata')) not between 9 and 20 then
    raise exception 'You can pause or unpause between 9 AM and 9 PM';
  end if;
end;
$$;


create or replace function public.pause_my_plan(plan_order text, pause_from date, resume_on date, pause_reason text, plan_label text, litres_per_day numeric)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  me text := public.current_mobile();
  today date := (now() at time zone 'Asia/Kolkata')::date;
  plan public.orders;
  new_id text := 'PR-' || upper(to_hex((extract(epoch from clock_timestamp()) * 1000)::bigint));
  from_text text := to_char(pause_from, 'YYYY-MM-DD') || 'T00:00:00+05:30';
  to_text text := to_char(resume_on, 'YYYY-MM-DD') || 'T00:00:00+05:30';
begin
  perform private.check_pause_hours();
  select * into plan from public.orders
   where order_number = plan_order and customer_mobile = me and subscription is not null and status <> 'cancelled'
   for update;
  if plan.id is null then
    raise exception 'That plan is not yours' using errcode = '42501';
  end if;
  if pause_from <= today then
    raise exception 'A pause starts from tomorrow at the earliest';
  end if;
  if resume_on <= pause_from or resume_on - pause_from > 22 then
    raise exception 'A pause is for 1 to 22 days';
  end if;
  if pause_from > private.plan_last_day(plan) then
    raise exception 'Your plan ends before this day';
  end if;
  if exists (select 1 from public.panel_records p
              where p.module = 'pause-requests' and p.data ->> 'status' = 'Approved' and p.data ->> 'websiteOrderId' = plan_order
                and ((p.data ->> 'resumeOn')::timestamptz at time zone 'Asia/Kolkata')::date > today) then
    raise exception 'This plan is already paused';
  end if;

  insert into public.panel_records (module, id, data, owner_mobile)
  values ('pause-requests', new_id, jsonb_build_object(
            'id', new_id, 'customerName', plan.customer_name, 'area', coalesce(plan.area, ''), 'plan', plan_label,
            'frequency', 'Daily', 'litresPerDay', litres_per_day, 'pauseFrom', from_text, 'resumeOn', to_text,
            'reason', pause_reason, 'status', 'Approved', 'decidedBy', 'Customer', 'requestedAt', to_jsonb(now()),
            'websiteOrderId', plan_order, 'customerMobile', me),
          me);
  perform private.set_plan_paused_days(plan_order);
  update public.panel_records
     set data = data || jsonb_build_object('pauseFrom', from_text, 'resumeOn', to_text)
   where module = 'subscriptions' and data ->> 'websiteOrderId' = plan_order;
end;
$$;


create or replace function public.unpause_my_plan(request_id text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  me text := public.current_mobile();
  tomorrow date := (now() at time zone 'Asia/Kolkata')::date + 1;
  request public.panel_records;
  first_day date;
  resume_day date;
  plan_order text;
  tomorrow_text text := to_char((now() at time zone 'Asia/Kolkata')::date + 1, 'YYYY-MM-DD') || 'T00:00:00+05:30';
begin
  perform private.check_pause_hours();
  select * into request from public.panel_records
   where module = 'pause-requests' and id = request_id and owner_mobile = me and data ->> 'status' = 'Approved'
   for update;
  if request.id is null then
    raise exception 'That pause is not yours' using errcode = '42501';
  end if;
  plan_order := request.data ->> 'websiteOrderId';
  first_day := ((request.data ->> 'pauseFrom')::timestamptz at time zone 'Asia/Kolkata')::date;
  resume_day := ((request.data ->> 'resumeOn')::timestamptz at time zone 'Asia/Kolkata')::date;
  if resume_day <= tomorrow then
    raise exception 'Your milk already starts again tomorrow';
  end if;

  if first_day >= tomorrow then
    -- Not started yet: called off
    update public.panel_records
       set data = data || jsonb_build_object('status', 'Unpaused', 'unpausedAt', to_jsonb(now()))
     where module = 'pause-requests' and id = request_id;
    update public.panel_records set data = data - 'pauseFrom' - 'resumeOn'
     where module = 'subscriptions' and data ->> 'websiteOrderId' = plan_order;
  else
    -- Running: it ends tomorrow
    update public.panel_records
       set data = data || jsonb_build_object('resumeOn', tomorrow_text, 'unpausedAt', to_jsonb(now()))
     where module = 'pause-requests' and id = request_id;
    update public.panel_records set data = data || jsonb_build_object('resumeOn', tomorrow_text)
     where module = 'subscriptions' and data ->> 'websiteOrderId' = plan_order;
  end if;
  perform private.set_plan_paused_days(plan_order);
end;
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
              || jsonb_build_object('id', new_id, 'date', today_key, 'status', 'Pending', 'isSubscription', true),
            last_stop.owner_mobile)
    on conflict do nothing;
    if found then
      added := added + 1;
    end if;
  end loop;
  return added;
end;
$$;

-- Waiting requests: nobody approves them any more
update public.panel_records
   set data = data || '{"status": "Unpaused", "decidedBy": "Cleared"}'::jsonb
 where module = 'pause-requests' and data ->> 'status' = 'Pending' and data ->> 'kind' is distinct from 'skip';

revoke execute on function private.set_plan_paused_days(text) from public, anon, authenticated;
revoke execute on function private.plan_last_day(public.orders) from public, anon, authenticated;
revoke execute on function private.check_pause_hours() from public, anon, authenticated;
revoke execute on function public.pause_my_plan(text, date, date, text, text, numeric) from public, anon;
revoke execute on function public.unpause_my_plan(text) from public, anon;
revoke execute on function public.create_todays_plan_stops() from public, anon;
grant execute on function public.pause_my_plan(text, date, date, text, text, numeric) to authenticated;
grant execute on function public.unpause_my_plan(text) to authenticated;
grant execute on function public.create_todays_plan_stops() to authenticated;
