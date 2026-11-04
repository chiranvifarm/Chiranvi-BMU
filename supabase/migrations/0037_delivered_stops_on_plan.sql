-- =====================================================================================================
-- 0037 · A delivered stop shows on the customer's calendar
--   The customer's calendar reads the plan's delivered days (orders.subscription: deliveredDays). Only the
--   calendar's Delivered button (0036) saved them; a stop delivered from Ongoing or the panel's Deliveries did
--   not. order_follows_its_stop() (0025) now keeps that list right for every stop of a plan: the stop's day is
--   in the list while a stop of that day is Delivered, and comes off if it is changed to something else.
--   The rest of the function is as it was. Days already delivered are added once, below.
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
  stop_day text;
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

  -- A plan's delivered days, for the customer's calendar
  stop_day := stop_data ->> 'date';
  if stop_day is not null then
    update public.orders
       set subscription = subscription || jsonb_build_object('deliveredDays', (
             select coalesce(jsonb_agg(delivered_day order by delivered_day), '[]'::jsonb)
               from (
                 select saved_day as delivered_day
                   from jsonb_array_elements_text(coalesce(subscription -> 'deliveredDays', '[]'::jsonb)) as saved_day
                  where saved_day <> stop_day
                 union
                 select stop_day
                  where exists (select 1 from public.panel_records d
                                 where d.module = 'deliveries' and d.data ->> 'orderNumber' = stop_order_number
                                   and d.data ->> 'date' = stop_day and d.data ->> 'status' = 'Delivered')
               ) as delivered_days))
     where '#' || orders.order_number = stop_order_number and subscription is not null;
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

-- Days already delivered before this
update public.orders o
   set subscription = o.subscription || jsonb_build_object('deliveredDays', (
         select coalesce(jsonb_agg(delivered_day order by delivered_day), '[]'::jsonb)
           from (
             select saved_day as delivered_day
               from jsonb_array_elements_text(coalesce(o.subscription -> 'deliveredDays', '[]'::jsonb)) as saved_day
             union
             select d.data ->> 'date'
               from public.panel_records d
              where d.module = 'deliveries' and d.data ->> 'orderNumber' = '#' || o.order_number
                and d.data ->> 'status' = 'Delivered' and d.data ->> 'date' is not null
           ) as delivered_days))
 where o.subscription is not null
   and exists (select 1 from public.panel_records d
                where d.module = 'deliveries' and d.data ->> 'orderNumber' = '#' || o.order_number
                  and d.data ->> 'status' = 'Delivered');
