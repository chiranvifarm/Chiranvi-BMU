-- =====================================================================================================
-- 0053 · Planned milk plan deliveries on future days (Deliveries page, Custom range)
--   A plan's stop for a day is only made that morning (create_todays_plan_stops), so a future day has no plan
--   stops saved yet. public.upcoming_plan_stops(from_day, to_day) works out the ones that will be made, with
--   the same rules as the morning: the plan is running (first to last day), not paused that day, and has
--   an agent (the one on its last stop). A day that already has the plan's stop saved is left out (the
--   page shows the saved one). Each planned stop is marked "isPlanned": true.
--   Read only: nothing is saved or changed. No new table.
-- Safe to run again.
-- =====================================================================================================

create or replace function public.upcoming_plan_stops(from_day date, to_day date)
returns setof jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  first_day date := greatest(from_day, today + 1);
  -- At most about three months at a time, so a very long range doesn't make a huge list
  last_day date := least(to_day, greatest(from_day, today + 1) + 92);
begin
  if not coalesce((select public.has_permission('deliveries', 'view')), false) then
    raise exception 'You can''t see the deliveries' using errcode = '42501';
  end if;
  if from_day is null or to_day is null or last_day < first_day then
    return;
  end if;

  return query
  select (last_stop.data - 'history' - 'transferRequest' - 'deliveredAt' - 'proof')
           || jsonb_build_object('id', 'D-' || to_char(planned.day, 'YYYYMMDD') || '-' || plan.order_number,
                                 'date', to_char(planned.day, 'YYYY-MM-DD'), 'status', 'Pending',
                                 'isSubscription', true, 'isPlanned', true,
                                 'items', private.one_day_items(last_stop.data -> 'items', plan.subscription))
    from public.orders plan
    -- The plan's agent: the one on its last stop (as in the morning). No stop yet: no agent, nothing planned
    cross join lateral (
      select d.data from public.panel_records d
       where d.module = 'deliveries' and d.owner_mobile is not null and d.data ->> 'orderNumber' = '#' || plan.order_number
       order by d.data ->> 'date' desc, d.created_at desc
       limit 1
    ) last_stop
    cross join lateral (
      select generate_series(greatest(first_day, private.day_before_first_delivery(plan) + 1)::timestamp,
                             least(last_day, private.plan_last_day(plan))::timestamp,
                             interval '1 day')::date as day
    ) planned
   where plan.subscription is not null and plan.status <> 'cancelled' and not (plan.subscription ? 'extendsOrderId')
     -- Paused that day (an approved pause)
     and not exists (
       select 1 from public.panel_records p
        where p.module = 'pause-requests' and p.data ->> 'status' = 'Approved' and p.data ->> 'websiteOrderId' = plan.order_number
          and planned.day >= ((p.data ->> 'pauseFrom')::timestamptz at time zone 'Asia/Kolkata')::date
          and planned.day < ((p.data ->> 'resumeOn')::timestamptz at time zone 'Asia/Kolkata')::date)
     -- That day's stop is already saved
     and not exists (
       select 1 from public.panel_records d
        where d.module = 'deliveries' and d.data ->> 'orderNumber' = '#' || plan.order_number
          and d.data ->> 'date' = to_char(planned.day, 'YYYY-MM-DD'))
     -- The plan's first morning: an open stop made the day it was paid becomes that morning's stop
     and not (planned.day = private.day_before_first_delivery(plan) + 1 and exists (
       select 1 from public.panel_records d
        where d.module = 'deliveries' and d.data ->> 'orderNumber' = '#' || plan.order_number
          and d.data ->> 'date' <= to_char(private.day_before_first_delivery(plan), 'YYYY-MM-DD')
          and d.data ->> 'status' in ('Pending', 'Out for delivery')))
   order by planned.day, plan.order_number;
end;
$$;

revoke execute on function public.upcoming_plan_stops(date, date) from public, anon;
grant execute on function public.upcoming_plan_stops(date, date) to authenticated;
