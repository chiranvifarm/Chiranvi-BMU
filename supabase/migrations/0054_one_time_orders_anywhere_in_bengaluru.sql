-- =====================================================================================================
-- 0054 · One-time products anywhere in Bengaluru, given to the nearest agent
--   Milk plans don't change: only the 8 service areas (and the hub's distance limit once it is set).
--   1. Each of the 8 routes gets its area's centre (latitude, longitude, from OpenStreetMap; Narayana Nagar:
--      the Doddakallasandra metro beside it), to measure how near a route runs to an address.
--   2. Pay now (start_checkout): a cart with a milk plan keeps the 8-area rule. A cart of one-time products
--      only may go to a service area, or to any address whose city is Bengaluru / Bangalore (as typed on the
--      address), with a map pin. private.check_delivery_address() is told whether the cart has a plan.
--   3. Paid (auto_assign_order): a one-time order outside the 8 areas goes to the agent whose route runs
--      nearest its pin, in a straight line: the route's centre and the pins of the route's stops from the
--      week before up to that morning. Agents on leave are skipped; no agent: it waits on "Needs an agent".
--      The stop is put on that route and marked "isOutsideRoutes": true (the agent's app slots it in where it
--      adds the least riding). Orders in the 8 areas and milk plans are assigned as before.
--   No new table.
-- Safe to run again.
-- =====================================================================================================


-- 1. The routes' area centres ------------------------------------------------------------------------
update public.panel_records r
   set data = r.data || jsonb_build_object('latitude', centre.latitude, 'longitude', centre.longitude)
  from (values
    ('uttarahalli', 12.9056, 77.5455),
    ('chikkalasandra', 12.9122, 77.5476),
    ('vajarahalli', 12.8771, 77.5445),
    ('gubbalala', 12.8857, 77.5417),
    ('bcmc layout', 12.8766, 77.5500),
    ('narayana nagar', 12.8846, 77.5528),
    ('isro layout', 12.8974, 77.5574),
    ('silk institute', 12.8617, 77.5300)
  ) as centre (area, latitude, longitude)
 where r.module = 'routes' and lower(trim(r.data ->> 'area')) = centre.area
   and not (r.data ? 'latitude');


-- 2. Where an order may go ----------------------------------------------------------------------------
-- "Bengaluru", "Bangalore", "Bengaluru Urban", "Bangalore City"... (spaces, dots and case don't matter)
create or replace function private.is_bengaluru(city text)
returns boolean
language sql
immutable
as $$
  select regexp_replace(lower(coalesce(city, '')), '[^a-z]', '', 'g') ~ '^(bengaluru|bangalore)(urban|city)?$';
$$;

create or replace function private.check_delivery_address(p_address_id text, p_has_plan boolean)
returns void
language plpgsql
stable
set search_path to 'public'
as $$
declare
  service jsonb := (select value from public.app_settings where key = 'delivery_service');
  contact text;
  the_address public.addresses;
  is_service_area boolean;
begin
  if service is null then
    return;
  end if;
  contact := '+91 ' || (service ->> 'contactPhone');
  if coalesce(p_address_id, '') !~ '^[0-9a-fA-F-]{36}$' then
    raise exception 'Choose a delivery address' using errcode = 'P0001', hint = 'address';
  end if;
  select a.* into the_address
  from public.addresses a
  join public.customers c on c.id = a.customer_id
  where a.id = p_address_id::uuid and c.user_id = auth.uid();
  if not found then
    raise exception 'Choose a delivery address' using errcode = 'P0001', hint = 'address';
  end if;
  is_service_area := exists (
    select 1 from jsonb_array_elements_text(service -> 'areas') as area
    where lower(trim(area.value)) = lower(trim(the_address.area)));
  -- A milk plan: only the service areas. One-time products only: the service areas or anywhere in Bengaluru
  if p_has_plan and not is_service_area then
    raise exception 'We don''t deliver to % yet. Please contact the farm on %.', the_address.area, contact using errcode = 'P0001', hint = 'address';
  end if;
  if not p_has_plan and not is_service_area and not private.is_bengaluru(the_address.city) then
    raise exception 'We don''t deliver to % yet. Please contact the farm on %.', coalesce(nullif(trim(the_address.city), ''), the_address.area), contact using errcode = 'P0001', hint = 'address';
  end if;
  if the_address.latitude is null then
    raise exception 'Add your location to this address to continue.' using errcode = 'P0001', hint = 'address';
  end if;
  -- The hub's distance limit is for the milk plans' routes
  if p_has_plan and jsonb_typeof(service -> 'hub') = 'object' and jsonb_typeof(service -> 'limitKm') = 'number'
     and private.km_between((service -> 'hub' ->> 'latitude')::double precision, (service -> 'hub' ->> 'longitude')::double precision,
                            the_address.latitude, the_address.longitude) > (service ->> 'limitKm')::double precision then
    raise exception 'This address is outside our delivery area. Please contact the farm on %.', contact using errcode = 'P0001', hint = 'address';
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION public.start_checkout(details jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  mobile text := public.current_mobile();
  checkout uuid := gen_random_uuid();
  plan_answer jsonb;
  items_answer jsonb;
  answers jsonb := '[]'::jsonb;
  total_paise integer := 0;
begin
  if auth.uid() is null or coalesce(mobile, '') !~ '^\d{10}$' then
    raise exception 'Log in to place an order';
  end if;
  if jsonb_typeof(details -> 'planOrder') is distinct from 'object' and jsonb_typeof(details -> 'itemsOrder') is distinct from 'object' then
    raise exception 'The order has no items';
  end if;

  -- A new order must go to an address we deliver to ("Extend Plan" keeps its plan's address). With a milk plan:
  -- the service areas; one-time products only: also anywhere in Bengaluru
  if coalesce(details -> 'planOrder' -> 'subscription' ->> 'extendsOrderId', '') = '' then
    perform private.check_delivery_address(coalesce(details -> 'planOrder' ->> 'addressId', details -> 'itemsOrder' ->> 'addressId'),
                                           jsonb_typeof(details -> 'planOrder') = 'object');
  end if;

  -- Unpaid orders this customer left behind (the payment was never finished)
  delete from public.orders
  where customer_mobile = mobile and payment_status = 'awaiting_payment' and placed_at < now() - interval '1 hour';

  if jsonb_typeof(details -> 'planOrder') = 'object' then
    plan_answer := private.save_order(details -> 'planOrder', checkout);
    answers := answers || jsonb_build_array(plan_answer);
    total_paise := total_paise + (plan_answer ->> 'totalPaise')::integer;
  end if;
  if jsonb_typeof(details -> 'itemsOrder') = 'object' then
    items_answer := private.save_order(
      details -> 'itemsOrder' || jsonb_build_object('planOrderNumber', plan_answer ->> 'orderNumber'), checkout);
    answers := answers || jsonb_build_array(items_answer);
    total_paise := total_paise + (items_answer ->> 'totalPaise')::integer;
  end if;

  -- The customer must have seen this same total (half a rupee either way for rounding): otherwise nothing is kept
  if details ->> 'shownTotal' is null or abs(round((details ->> 'shownTotal')::numeric * 100) - total_paise) > 50 then
    raise exception 'Prices have changed. Please check your cart and pay again.' using hint = 'prices';
  end if;

  -- The one-time items must be in stock; not enough left: nothing is kept
  perform private.hold_checkout_stock(checkout, mobile);

  return jsonb_build_object('checkoutId', checkout, 'amountPaise', total_paise, 'orders', answers);
end;
$function$;

-- The old check (no plan / one-time choice) is no longer used
drop function if exists private.check_delivery_address(text);


-- 3. Paid: the route's agent, or for a one-time order outside the 8 areas the nearest agent --------------
CREATE OR REPLACE FUNCTION private.auto_assign_order(paid orders)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  today_key text := to_char((paid.promised_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD');
  the_route public.panel_records;
  the_agent public.panel_records;
  items jsonb;
  stop_id text := 'D-' || replace(today_key, '-', '') || '-' || paid.order_number;
  stop_data jsonb;
  is_outside_routes boolean := false;
begin
  if coalesce(paid.subscription ->> 'extendsOrderId', '') <> '' then
    return;
  end if;
  if exists (select 1 from public.panel_records d where d.module = 'deliveries' and d.data ->> 'orderNumber' = '#' || paid.order_number) then
    return;
  end if;
  select r.* into the_route from public.panel_records r
   where r.module = 'routes' and lower(trim(r.data ->> 'area')) = lower(trim(paid.area))
   order by r.sort_order, r.id
   limit 1;
  -- One-time products outside the 8 areas: the route (with an agent at work) that runs nearest the pin
  if the_route.id is null and paid.subscription is null and paid.delivery_latitude is not null and paid.delivery_longitude is not null then
    select r.* into the_route
      from public.panel_records r
      join public.panel_records a on a.module = 'agents' and a.id = r.data ->> 'agent'
      cross join lateral (
        select least(
          case when jsonb_typeof(r.data -> 'latitude') = 'number' and jsonb_typeof(r.data -> 'longitude') = 'number'
               then private.km_between((r.data ->> 'latitude')::double precision, (r.data ->> 'longitude')::double precision,
                                       paid.delivery_latitude, paid.delivery_longitude) end,
          (select min(private.km_between((d.data ->> 'latitude')::double precision, (d.data ->> 'longitude')::double precision,
                                         paid.delivery_latitude, paid.delivery_longitude))
             from public.panel_records d
            where d.module = 'deliveries' and d.data ->> 'routeId' = r.id
              and jsonb_typeof(d.data -> 'latitude') = 'number' and jsonb_typeof(d.data -> 'longitude') = 'number'
              and d.data ->> 'date' between to_char((paid.promised_at at time zone 'Asia/Kolkata')::date - 7, 'YYYY-MM-DD') and today_key)
        ) as km
      ) nearness
     where r.module = 'routes' and coalesce(r.data ->> 'agent', '') <> ''
       and not coalesce((a.data ->> 'isOnLeave')::boolean, false) and coalesce(a.owner_mobile, '') ~ '^\d{10}$'
       and nearness.km is not null
     order by nearness.km, r.sort_order, r.id
     limit 1;
    is_outside_routes := the_route.id is not null;
  end if;
  if the_route.id is null or coalesce(the_route.data ->> 'agent', '') = '' then
    return;
  end if;
  select a.* into the_agent from public.panel_records a where a.module = 'agents' and a.id = the_route.data ->> 'agent';
  if the_agent.id is null or coalesce((the_agent.data ->> 'isOnLeave')::boolean, false) or coalesce(the_agent.owner_mobile, '') !~ '^\d{10}$' then
    return;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'packSize', i.pack_size, 'quantity', i.quantity, 'price', i.price_paise / 100.0) order by i.position), '[]'::jsonb)
    into items
  from public.order_items i where i.order_id = paid.id;
  -- A milk plan's stop is one day's bottles, not the whole plan
  if paid.subscription is not null then
    items := private.one_day_items(items, paid.subscription);
  end if;

  stop_data := jsonb_strip_nulls(jsonb_build_object(
    'id', stop_id,
    'date', today_key,
    'orderNumber', '#' || paid.order_number,
    -- "Name · #12, 4th Cross, Kengeri": who receives it, and where
    'customerName', coalesce(nullif(trim(split_part(paid.deliver_to, ' · ', 1)), ''), paid.customer_name),
    'address', coalesce(nullif(trim(substr(paid.deliver_to, length(split_part(paid.deliver_to, ' · ', 1)) + 4)), ''), paid.area),
    'phone', coalesce(paid.delivery_mobile, paid.customer_mobile),
    'area', paid.area,
    'routeId', the_route.id,
    'agent', the_agent.id,
    'slot', '6–7 AM',
    'status', 'Pending',
    'isSubscription', paid.subscription is not null,
    'isAutoAssigned', true,
    -- Outside the 8 areas, given to the nearest route (the agent's app slots it in where it adds the least riding)
    'isOutsideRoutes', case when is_outside_routes then true end,
    'items', items,
    'cashToCollect', 0,
    'latitude', paid.delivery_latitude,
    'longitude', paid.delivery_longitude,
    'history', jsonb_build_array(jsonb_build_object('kind', 'assigned', 'at', to_jsonb(now()), 'toAgent', the_agent.id))));
  insert into public.panel_records (module, id, data, owner_mobile, is_sample)
  values ('deliveries', stop_id, stop_data, the_agent.owner_mobile, false)
  on conflict do nothing;
end;
$function$;

revoke execute on function private.is_bengaluru(text) from public, anon, authenticated;
revoke execute on function private.check_delivery_address(text, boolean) from public, anon, authenticated;
revoke execute on function private.auto_assign_order(public.orders) from public, anon, authenticated;
