-- =====================================================================================================
-- 0035 · A delivery agent's plan calendars
--   my_assigned_plans(): the milk plans a manager gave to the logged-in agent (a stop with their number for a
--   plan's order), for the Delivery Panel's calendar. Agents can't read orders themselves, so this answers only
--   what the calendar needs: the customer, the milk, the plan's first and last day (extensions, approved pauses
--   and skips included), the approved skips and pauses, and how each stop ended. Read only. No new table.
-- Safe to run again.
-- =====================================================================================================

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
             where d.module = 'deliveries' and d.data ->> 'orderNumber' = '#' || o.order_number), '{}'::jsonb)
        ) as plan
          from public.orders o
         where o.subscription is not null and o.status <> 'cancelled'
           and exists (select 1 from public.panel_records d
                        where d.module = 'deliveries' and d.owner_mobile = me and d.data ->> 'orderNumber' = '#' || o.order_number)
      ) as plans), '[]'::jsonb);
end;
$$;

revoke execute on function public.my_assigned_plans() from public, anon;
grant execute on function public.my_assigned_plans() to authenticated;
