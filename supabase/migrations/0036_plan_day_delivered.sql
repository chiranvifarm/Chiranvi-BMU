-- =====================================================================================================
-- 0036 · An agent marks today's milk delivered
--   mark_plan_day_delivered(): from the Delivery Panel's calendar. Only the plan's own agent, only today, only
--   on a day of the plan that isn't skipped or paused. It saves the day everywhere:
--   - on the plan's order (orders.subscription: deliveredDays), which the customer's calendar reads;
--   - as today's stop in Deliveries (Delivered), which the panel's Deliveries page and the agent's Completed
--     read: today's stop if there is one, else a new one from the plan's last stop.
--   my_assigned_plans() also answers the stop's slot: the panel's delivery time, shown as "Deliver before".
--   "Today" is the date in India. No new table.
-- Safe to run again.
-- =====================================================================================================

create or replace function public.mark_plan_day_delivered(plan_order text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  me text := private.current_delivery_agent();
  today date := (now() at time zone 'Asia/Kolkata')::date;
  today_key text := to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD');
  plan public.orders;
  last_stop public.panel_records;
  today_stop text;
  last_day date;
begin
  select * into plan from public.orders where order_number = plan_order and subscription is not null and status <> 'cancelled' for update;
  select * into last_stop from public.panel_records
   where module = 'deliveries' and owner_mobile = me and data ->> 'orderNumber' = '#' || plan_order
   order by data ->> 'date' desc, created_at desc limit 1;
  if plan.id is null or last_stop.id is null then
    raise exception 'This plan is not yours' using errcode = '42501';
  end if;

  last_day := (plan.placed_at at time zone 'Asia/Kolkata')::date
              + coalesce((plan.subscription ->> 'days')::integer, 0) + coalesce((plan.subscription ->> 'pausedDays')::integer, 0)
              + coalesce((select sum((e.subscription ->> 'days')::integer)::integer from public.orders e
                           where e.subscription ->> 'extendsOrderId' = plan_order and e.status <> 'cancelled'
                             and e.payment_status in ('paid', 'not_charged')), 0);
  if today <= (plan.placed_at at time zone 'Asia/Kolkata')::date or today > last_day then
    raise exception 'Today is not a delivery day of this plan';
  end if;
  if exists (select 1 from public.panel_records p
              where p.module = 'pause-requests' and p.data ->> 'status' = 'Approved'
                and plan_order in (p.data ->> 'websiteOrderId', p.data ->> 'planOrderId')
                and today >= ((p.data ->> 'pauseFrom')::timestamptz at time zone 'Asia/Kolkata')::date
                and today < ((p.data ->> 'resumeOn')::timestamptz at time zone 'Asia/Kolkata')::date) then
    raise exception 'Today is skipped or paused for this customer';
  end if;
  if coalesce(plan.subscription -> 'deliveredDays', '[]'::jsonb) ? today_key then
    return;
  end if;

  update public.orders
     set subscription = subscription || jsonb_build_object(
           'deliveredDays', coalesce(subscription -> 'deliveredDays', '[]'::jsonb) || to_jsonb(today_key))
   where id = plan.id;

  select id into today_stop from public.panel_records
   where module = 'deliveries' and data ->> 'orderNumber' = '#' || plan_order and data ->> 'date' = today_key
   order by created_at desc limit 1;
  if today_stop is not null then
    update public.panel_records
       set data = data || jsonb_build_object('status', 'Delivered', 'deliveredAt', to_jsonb(now()))
     where module = 'deliveries' and id = today_stop;
  else
    insert into public.panel_records (module, id, data, owner_mobile)
    values ('deliveries', 'D-' || replace(today_key, '-', '') || '-' || plan_order,
            (last_stop.data - 'history' - 'transferRequest')
              || jsonb_build_object('id', 'D-' || replace(today_key, '-', '') || '-' || plan_order, 'date', today_key,
                                    'status', 'Delivered', 'deliveredAt', to_jsonb(now()), 'isSubscription', true),
            me);
  end if;
end;
$$;

create or replace function public.my_assigned_plans()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  me text := private.current_delivery_agent();
begin
  return coalesce((
    select jsonb_agg(plan order by plan ->> 'customerName')
      from (
        select jsonb_build_object(
          'orderNumber', o.order_number,
          'customerName', o.customer_name,
          'area', coalesce(o.area, ''),
          'milk', coalesce((select i.name from public.order_items i where i.order_id = o.id order by i.position limit 1), ''),
          'bottles', trim(concat_ws(' × ', o.subscription ->> 'bottlesPerDay', coalesce(o.subscription ->> 'bottleLabel', '1 L'))),
          'firstDay', ((o.placed_at at time zone 'Asia/Kolkata')::date + 1)::text,
          'lastDay', ((o.placed_at at time zone 'Asia/Kolkata')::date
                      + coalesce((o.subscription ->> 'days')::integer, 0)
                      + coalesce((o.subscription ->> 'pausedDays')::integer, 0)
                      + coalesce((select sum((e.subscription ->> 'days')::integer)::integer from public.orders e
                                   where e.subscription ->> 'extendsOrderId' = o.order_number and e.status <> 'cancelled'
                                     and e.payment_status in ('paid', 'not_charged')), 0))::text,
          'skips', coalesce((
            select jsonb_agg(((p.data ->> 'pauseFrom')::timestamptz at time zone 'Asia/Kolkata')::date::text)
              from public.panel_records p
             where p.module = 'pause-requests' and p.data ->> 'kind' = 'skip'
               and p.data ->> 'planOrderId' = o.order_number and p.data ->> 'status' = 'Approved'), '[]'::jsonb),
          'pauses', coalesce((
            select jsonb_agg(jsonb_build_object(
                     'from', ((p.data ->> 'pauseFrom')::timestamptz at time zone 'Asia/Kolkata')::date::text,
                     'to', ((p.data ->> 'resumeOn')::timestamptz at time zone 'Asia/Kolkata')::date::text))
              from public.panel_records p
             where p.module = 'pause-requests' and p.data ->> 'websiteOrderId' = o.order_number and p.data ->> 'status' = 'Approved'), '[]'::jsonb),
          'stops', coalesce((
            select jsonb_object_agg(d.data ->> 'date', d.data ->> 'status')
              from public.panel_records d
             where d.module = 'deliveries' and d.data ->> 'orderNumber' = '#' || o.order_number), '{}'::jsonb),
          'slot', coalesce((
            select d.data ->> 'slot' from public.panel_records d
             where d.module = 'deliveries' and d.data ->> 'orderNumber' = '#' || o.order_number
             order by d.data ->> 'date' desc limit 1), '')
        ) as plan
          from public.orders o
         where o.subscription is not null and o.status <> 'cancelled'
           and exists (select 1 from public.panel_records d
                        where d.module = 'deliveries' and d.owner_mobile = me and d.data ->> 'orderNumber' = '#' || o.order_number)
      ) as plans), '[]'::jsonb);
end;
$$;

revoke execute on function public.mark_plan_day_delivered(text) from public, anon;
grant execute on function public.mark_plan_day_delivered(text) to authenticated;
