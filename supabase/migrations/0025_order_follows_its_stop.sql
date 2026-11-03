-- =====================================================================================================
-- 0025 · An order follows its delivery stop
--   When the agent starts an order's stop (Picked up: the stop is Out for delivery) the order becomes
--   "Out for delivery"; when they deliver it (Delivered / Left at door) the order becomes "Delivered". The
--   customer's My Orders and the panel's Orders page show it. A stop not delivered (Missed) leaves the order.
--   order_follows_its_stop(stop_id): called by the website just after the stop's step is saved. It reads the
--   stop as the database has it (not what the browser says) and only works for the stop's own agent (their
--   number is on it) or staff who may change Deliveries. Orders only move forward: never back, never out of
--   Cancelled or Delivered.
--   Website orders are in "orders"; orders made in the panel are in panel_records ("orders").
--   No new table.
-- Safe to run again.
-- =====================================================================================================

create or replace function public.order_follows_its_stop(stop_id text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  stop_data jsonb;
  stop_owner text;
  stop_order_number text;
  website_status text;  -- out-for-delivery / delivered
  panel_status text;    -- Out for delivery / Delivered
  moved_from text[];
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  select data, owner_mobile into stop_data, stop_owner
    from public.panel_records where module = 'deliveries' and id = stop_id;
  if stop_data is null then
    return null;
  end if;
  if stop_owner is distinct from (select public.current_mobile()) and not (select public.has_permission('deliveries', 'edit')) then
    raise exception 'Not your stop' using errcode = '42501';
  end if;

  stop_order_number := stop_data ->> 'orderNumber';
  if stop_order_number is null then
    return null;
  end if;
  case stop_data ->> 'status'
    when 'Out for delivery' then website_status := 'out-for-delivery'; panel_status := 'Out for delivery';
      moved_from := array['placed', 'packed'];
    when 'Delivered' then website_status := 'delivered'; panel_status := 'Delivered';
      moved_from := array['placed', 'packed', 'out-for-delivery'];
    else
      return null;
  end case;

  -- A website order ("#CF-60085" is order CF-60085)
  update public.orders
     set status = website_status,
         status_changed_at = coalesce(status_changed_at, '{}'::jsonb) || jsonb_build_object(website_status, now_ms)
   where '#' || orders.order_number = stop_order_number
     and status = any(moved_from);

  -- An order made in the panel (its old step "Pending" is "Placed")
  update public.panel_records
     set data = data || jsonb_build_object(
           'status', panel_status,
           'statusChangedAt', coalesce(data -> 'statusChangedAt', '{}'::jsonb) || jsonb_build_object(panel_status, to_jsonb(now())))
   where module = 'orders' and id = stop_order_number
     and data ->> 'status' = any(case when panel_status = 'Delivered'
                                      then array['Placed', 'Pending', 'Packed', 'Out for delivery']
                                      else array['Placed', 'Pending', 'Packed'] end);

  return website_status;
end;
$$;

revoke execute on function public.order_follows_its_stop(text) from public, anon;
grant execute on function public.order_follows_its_stop(text) to authenticated;
