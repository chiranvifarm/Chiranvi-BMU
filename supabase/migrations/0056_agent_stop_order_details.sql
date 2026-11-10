-- =====================================================================================================
-- 0056 · A stop's order details for the delivery agent (Delivery Panel → Up next → tap a stop)
--   Agents can't read the orders table, so my_stop_order(order_number) answers, for one order the logged-in
--   agent has a stop of: when it was ordered, the total, how it was paid and, for a milk plan, the plan
--   (name, length, bottles a day, first and last day). Nothing for an order with no stop of this agent.
--   Read only: nothing is saved or changed. No new table.
-- Safe to run again.
-- =====================================================================================================

create or replace function public.my_stop_order(p_order_number text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  me text := private.current_delivery_agent();
  wanted text := ltrim(coalesce(p_order_number, ''), '#');
  found_order public.orders;
begin
  -- Only an order this agent has (or had) a stop of
  if not exists (
    select 1 from public.panel_records d
     where d.module = 'deliveries' and d.owner_mobile = me and d.data ->> 'orderNumber' = '#' || wanted) then
    return null;
  end if;

  select * into found_order from public.orders o where o.order_number = wanted;
  if found_order.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'orderNumber', found_order.order_number,
    'placedAt', found_order.placed_at,
    'totalRupees', found_order.total_paise / 100.0,
    'paymentMethod', coalesce(found_order.payment_method, ''),
    'paymentStatus', coalesce(found_order.payment_status, ''),
    'plan', case when found_order.subscription is null then null else jsonb_build_object(
      'name', coalesce(found_order.subscription ->> 'planName', ''),
      'days', coalesce((found_order.subscription ->> 'days')::integer, 0),
      'bottlesPerDay', coalesce((found_order.subscription ->> 'bottlesPerDay')::integer, 1),
      'firstDay', (private.day_before_first_delivery(found_order) + 1)::text,
      'lastDay', private.plan_last_day(found_order)::text) end);
end;
$$;
revoke execute on function public.my_stop_order(text) from public, anon;
grant execute on function public.my_stop_order(text) to authenticated;
