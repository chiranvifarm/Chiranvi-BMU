-- =====================================================================================================
-- 0053 · A later day's plan customers, for the Delivery Panel's Up next calendar
--   A plan's stop is made only on its own morning (create_todays_plan_stops, 0046 / 0051), so a later day has no
--   plan stops yet. my_plan_stops_for_day() answers the stops that morning will have for the logged-in agent:
--   the same plans create_todays_plan_stops() would pick (running that day, not paused, the agent of its last
--   stop), shaped like a stop. A plan that already has a stop that day is left out (the page reads that stop).
--   Read only: it makes no stop and changes nothing. Only days after today.
--   No new table.
-- Safe to run again.
-- =====================================================================================================

create or replace function public.my_plan_stops_for_day(p_day date)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  me text := private.current_delivery_agent();
  today date := (now() at time zone 'Asia/Kolkata')::date;
  day_key text := to_char(p_day, 'YYYY-MM-DD');
  plan public.orders;
  last_stop public.panel_records;
  answer jsonb := '[]'::jsonb;
begin
  if p_day is null or p_day <= today then
    return answer;
  end if;

  for plan in
    select * from public.orders o
     where o.subscription is not null and o.status <> 'cancelled' and not (o.subscription ? 'extendsOrderId')
  loop
    -- The plan's agent: the one on its last stop, as each morning does
    select * into last_stop from public.panel_records d
     where d.module = 'deliveries' and d.owner_mobile is not null and d.data ->> 'orderNumber' = '#' || plan.order_number
     order by d.data ->> 'date' desc, d.created_at desc
     limit 1;
    continue when last_stop.id is null or last_stop.owner_mobile <> me;

    continue when p_day <= private.day_before_first_delivery(plan) or p_day > private.plan_last_day(plan);
    continue when exists (
      select 1 from public.panel_records p
       where p.module = 'pause-requests' and p.data ->> 'status' = 'Approved' and p.data ->> 'websiteOrderId' = plan.order_number
         and p_day >= ((p.data ->> 'pauseFrom')::timestamptz at time zone 'Asia/Kolkata')::date
         and p_day < ((p.data ->> 'resumeOn')::timestamptz at time zone 'Asia/Kolkata')::date);
    continue when exists (
      select 1 from public.panel_records d
       where d.module = 'deliveries' and d.data ->> 'orderNumber' = '#' || plan.order_number and d.data ->> 'date' = day_key);

    answer := answer || jsonb_build_array(
      (last_stop.data - 'history' - 'transferRequest' - 'deliveredAt' - 'proof')
        || jsonb_build_object('id', 'D-' || replace(day_key, '-', '') || '-' || plan.order_number, 'date', day_key,
                              'status', 'Pending', 'isSubscription', true,
                              'items', private.one_day_items(last_stop.data -> 'items', plan.subscription)));
  end loop;
  return answer;
end;
$$;
revoke execute on function public.my_plan_stops_for_day(date) from public, anon;
grant execute on function public.my_plan_stops_for_day(date) to authenticated;
