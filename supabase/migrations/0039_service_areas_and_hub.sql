-- =====================================================================================================
-- 0039 · Where Chiranvi delivers: the 8 service areas, the farm hub and a distance limit
--   1. app_settings "delivery_service": {areas, hub, limitKm, contactPhone}. Everyone reads it (the cart shows
--      why an address can't be used). hub and limitKm are empty until set on Routes & agents.
--   2. set_delivery_hub(): saves the hub's exact spot (a phone's GPS, standing at the hub) and the distance limit.
--      Staff with Routes & agents → Edit only.
--   3. The routes: one per service area, replacing the old four. Set only the first time this runs, so running
--      it again never undoes the admin's changes. Two start with an agent; the admin gives out the rest.
--   4. Pay now (start_checkout): a new order must go to the customer's own saved address, in a service area, with
--      a map pin, and within the distance limit of the hub (once both are set). Otherwise nothing is saved and
--      the customer is told to contact the farm. The database reads the address itself; what the browser sends
--      as the area isn't trusted. A pincode can't decide this: several areas share one.
--      "Extend Plan" keeps its plan's address, so it isn't checked.
--   No new table.
-- Safe to run again.
-- =====================================================================================================


-- 1 + 3. The service areas and the routes (the first time only) ----------------------------------------
do $$
begin
  if exists (select 1 from public.app_settings where key = 'delivery_service') then
    return;
  end if;

  insert into public.app_settings (key, value, description) values
    ('delivery_service',
     '{"areas": ["Uttarahalli", "Chikkalasandra", "Vajarahalli", "Gubbalala", "BCMC Layout", "Narayana Nagar", "ISRO Layout", "Silk Institute"],
       "hub": null, "limitKm": null, "contactPhone": "9902881718"}',
     'Where Chiranvi delivers: the service areas, the farm hub (name, latitude, longitude), the distance limit from it in km, and the number to contact');

  insert into public.panel_records (module, id, data, owner_mobile, is_sample, sort_order)
  select 'routes', 'R' || route.position,
         jsonb_build_object('id', 'R' || route.position, 'name', 'Route ' || route.position, 'area', route.area,
                            'agent', route.agent, 'colour', route.colour),
         route.owner_mobile, false, route.position - 1
  from (values
    (1, 'Uttarahalli',    'bailwan Sharma', '9945686288', '#3d7a3a'),
    (2, 'Chikkalasandra', 'Harry Nogara',   '8888888888', '#e0a91f'),
    (3, 'Vajarahalli',    '',               null,         '#6f8f2e'),
    (4, 'Gubbalala',      '',               null,         '#b3872a'),
    (5, 'BCMC Layout',    '',               null,         '#2f6b52'),
    (6, 'Narayana Nagar', '',               null,         '#d9b54a'),
    (7, 'ISRO Layout',    '',               null,         '#3d7a3a'),
    (8, 'Silk Institute', '',               null,         '#e0a91f')
  ) as route (position, area, agent, owner_mobile, colour)
  on conflict (module, id) do update
    set data = excluded.data, owner_mobile = excluded.owner_mobile, is_sample = false, sort_order = excluded.sort_order;
end;
$$;

-- Only the owner changes it directly (0038's guard, with this row added); staff use set_delivery_hub()
create or replace function public.guard_money_settings()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_owner() or current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if new.key in ('free_delivery_from_paise', 'delivery_fee_paise', 'delivery_combine_rule', 'delivery_mixed_cart_fee_paise',
                 'delivery_product_rules', 'platform_fee_paise', 'plan_fee_rule', 'delivery_service')
     and new.value is distinct from old.value then
    raise exception 'Prices are changed only by the owner';
  end if;
  return new;
end;
$$;


-- 2. The hub ---------------------------------------------------------------------------------------------
-- A spot left empty keeps the saved one, so the limit can be changed without going back to the hub
create or replace function public.set_delivery_hub(p_latitude double precision, p_longitude double precision, p_limit_km numeric)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  saved jsonb;
begin
  if not (select public.has_permission('routes', 'edit')) then
    raise exception 'You can''t change the hub' using errcode = '42501';
  end if;
  if (p_latitude is null) <> (p_longitude is null)
     or p_latitude not between 6 and 37.5 or p_longitude not between 68 and 97.5 then
    raise exception 'That location is not in India';
  end if;
  if p_limit_km is not null and (p_limit_km < 1 or p_limit_km > 100) then
    raise exception 'The distance limit must be between 1 and 100 km';
  end if;
  update public.app_settings
     set value = value
                 || jsonb_build_object('limitKm', p_limit_km)
                 || case when p_latitude is null then '{}'::jsonb
                         else jsonb_build_object('hub', jsonb_build_object('name', 'Chiranvi Farm', 'latitude', p_latitude, 'longitude', p_longitude)) end
   where key = 'delivery_service'
  returning value into saved;
  return saved;
end;
$$;

revoke execute on function public.set_delivery_hub(double precision, double precision, numeric) from public, anon;
grant execute on function public.set_delivery_hub(double precision, double precision, numeric) to authenticated;


-- 4. The check at Pay now --------------------------------------------------------------------------------
-- Straight-line distance in km (the website's kmBetween() does the same)
create or replace function private.km_between(from_latitude double precision, from_longitude double precision,
                                              to_latitude double precision, to_longitude double precision)
returns double precision
language sql immutable
as $$
  select 2 * 6371 * asin(sqrt(
    sin(radians(to_latitude - from_latitude) / 2) ^ 2
    + cos(radians(from_latitude)) * cos(radians(to_latitude)) * sin(radians(to_longitude - from_longitude) / 2) ^ 2));
$$;

create or replace function private.check_delivery_address(p_address_id text)
returns void
language plpgsql stable
set search_path = public
as $$
declare
  service jsonb := (select value from public.app_settings where key = 'delivery_service');
  contact text;
  the_address public.addresses;
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
  if not exists (
    select 1 from jsonb_array_elements_text(service -> 'areas') as area
    where lower(trim(area.value)) = lower(trim(the_address.area))) then
    raise exception 'We don''t deliver to % yet. Please contact the farm on %.', the_address.area, contact using errcode = 'P0001', hint = 'address';
  end if;
  if the_address.latitude is null then
    raise exception 'Add your location to this address to continue.' using errcode = 'P0001', hint = 'address';
  end if;
  if jsonb_typeof(service -> 'hub') = 'object' and jsonb_typeof(service -> 'limitKm') = 'number'
     and private.km_between((service -> 'hub' ->> 'latitude')::double precision, (service -> 'hub' ->> 'longitude')::double precision,
                            the_address.latitude, the_address.longitude) > (service ->> 'limitKm')::double precision then
    raise exception 'This address is outside our delivery area. Please contact the farm on %.', contact using errcode = 'P0001', hint = 'address';
  end if;
end;
$$;

revoke execute on function private.km_between(double precision, double precision, double precision, double precision),
  private.check_delivery_address(text) from public, anon, authenticated;

-- 0029's start_checkout(), with the address checked first
create or replace function public.start_checkout(details jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
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

  -- A new order must go to an address we deliver to ("Extend Plan" keeps its plan's address)
  if coalesce(details -> 'planOrder' -> 'subscription' ->> 'extendsOrderId', '') = '' then
    perform private.check_delivery_address(coalesce(details -> 'planOrder' ->> 'addressId', details -> 'itemsOrder' ->> 'addressId'));
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
$$;
