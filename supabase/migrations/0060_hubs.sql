-- =====================================================================================================
-- 0060 · More than one hub
--   1. app_settings "delivery_service" gets "hubs": a list of {id, name, latitude, longitude, limitKm}. The one
--      hub there was becomes the first, "primary" (Chiranvi Farm), with its spot and limit if they were saved.
--      Its spot and limit are also kept in the old "hub" and "limitKm", so a page that still reads those works.
--   2. save_delivery_hub(): adds a hub (no id) or changes one: name, spot (set on the map or from a phone at
--      the hub; empty keeps the saved one) and its own "Deliver within (km)". remove_delivery_hub(): any hub but
--      the primary. Staff who may edit Routes & agents only. set_delivery_hub() (the primary) still works.
--   3. Each route uses the hub nearest its area's centre (0054); nothing to choose. private.hub_of_area() gives
--      it (no centre: the hub nearest the address itself).
--   4. Pay now with a milk plan: the address must be within the km limit of its route's hub (when that hub
--      has a limit). One-time products are not limited by a hub, as before.
--   No new table.
-- Safe to run again.
-- =====================================================================================================


-- 1. The list of hubs ---------------------------------------------------------------------------------
update public.app_settings
   set value = value || jsonb_build_object('hubs', jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
         'id', 'primary',
         'name', coalesce(value -> 'hub' ->> 'name', 'Chiranvi Farm'),
         'latitude', value -> 'hub' -> 'latitude',
         'longitude', value -> 'hub' -> 'longitude',
         'limitKm', value -> 'limitKm'))))
 where key = 'delivery_service' and not (value ? 'hubs');


-- 2. Adding, changing and removing a hub ----------------------------------------------------------------
create or replace function public.save_delivery_hub(p_hub_id text, p_name text, p_latitude double precision,
                                                    p_longitude double precision, p_limit_km numeric)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  service jsonb;
  hubs jsonb;
  hub_id text := nullif(trim(coalesce(p_hub_id, '')), '');
  hub_name text := nullif(trim(coalesce(p_name, '')), '');
  old_hub jsonb;
  new_hub jsonb;
  saved jsonb;
begin
  if not coalesce((select public.has_permission('routes', 'edit')), false) then
    raise exception 'You can''t change the hubs' using errcode = '42501';
  end if;
  if (p_latitude is null) <> (p_longitude is null)
     or p_latitude not between 6 and 37.5 or p_longitude not between 68 and 97.5 then
    raise exception 'That location is not in India';
  end if;
  if p_limit_km is not null and (p_limit_km < 1 or p_limit_km > 100) then
    raise exception 'The distance limit must be between 1 and 100 km';
  end if;
  if hub_name is not null and length(hub_name) > 40 then
    raise exception 'Keep the hub name to 40 letters';
  end if;

  select value into service from public.app_settings where key = 'delivery_service' for update;
  hubs := coalesce(service -> 'hubs', '[]'::jsonb);
  if hub_id is null then
    if hub_name is null then
      raise exception 'Give the hub a name';
    end if;
    if exists (select 1 from jsonb_array_elements(hubs) h where lower(h ->> 'name') = lower(hub_name)) then
      raise exception 'There is already a hub called %', hub_name;
    end if;
    hub_id := 'hub-' || substr(md5(gen_random_uuid()::text), 1, 8);
    old_hub := jsonb_build_object('id', hub_id);
  else
    select h into old_hub from jsonb_array_elements(hubs) h where h ->> 'id' = hub_id;
    if old_hub is null then
      raise exception 'That hub no longer exists';
    end if;
    if hub_name is not null and exists (select 1 from jsonb_array_elements(hubs) h
                                         where lower(h ->> 'name') = lower(hub_name) and h ->> 'id' <> hub_id) then
      raise exception 'There is already a hub called %', hub_name;
    end if;
  end if;

  -- An empty spot keeps the saved one; the limit is always the one given (empty: no limit)
  new_hub := jsonb_strip_nulls(jsonb_build_object(
    'id', hub_id,
    'name', coalesce(hub_name, old_hub ->> 'name', 'Hub'),
    'latitude', coalesce(to_jsonb(p_latitude), old_hub -> 'latitude'),
    'longitude', coalesce(to_jsonb(p_longitude), old_hub -> 'longitude'),
    'limitKm', to_jsonb(p_limit_km)));
  if exists (select 1 from jsonb_array_elements(hubs) h where h ->> 'id' = hub_id) then
    select jsonb_agg(case when h ->> 'id' = hub_id then new_hub else h end order by position) into hubs
      from jsonb_array_elements(hubs) with ordinality as list (h, position);
  else
    hubs := hubs || jsonb_build_array(new_hub);
  end if;

  service := service || jsonb_build_object('hubs', hubs);
  -- The primary hub also in the old "hub" / "limitKm"
  if hub_id = 'primary' then
    service := service || jsonb_build_object(
      'hub', case when new_hub ? 'latitude'
                  then jsonb_build_object('name', new_hub ->> 'name', 'latitude', new_hub -> 'latitude', 'longitude', new_hub -> 'longitude')
                  else 'null'::jsonb end,
      'limitKm', coalesce(new_hub -> 'limitKm', 'null'::jsonb));
  end if;
  update public.app_settings set value = service where key = 'delivery_service' returning value into saved;
  return saved;
end;
$$;

create or replace function public.remove_delivery_hub(p_hub_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  saved jsonb;
begin
  if not coalesce((select public.has_permission('routes', 'edit')), false) then
    raise exception 'You can''t change the hubs' using errcode = '42501';
  end if;
  if p_hub_id = 'primary' then
    raise exception 'The primary hub can''t be removed';
  end if;
  update public.app_settings
     set value = value || jsonb_build_object('hubs', coalesce((
           select jsonb_agg(h order by position) from jsonb_array_elements(value -> 'hubs') with ordinality as list (h, position)
            where h ->> 'id' <> p_hub_id), '[]'::jsonb))
   where key = 'delivery_service'
  returning value into saved;
  return saved;
end;
$$;

-- The primary hub, as before (Routes & agents before this change)
create or replace function public.set_delivery_hub(p_latitude double precision, p_longitude double precision, p_limit_km numeric)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return public.save_delivery_hub('primary', null, p_latitude, p_longitude, p_limit_km);
end;
$$;


-- 3. Which hub a route (an area) uses: the one nearest its centre -----------------------------------------
create or replace function private.hub_nearest(p_latitude double precision, p_longitude double precision)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  select h
    from public.app_settings s, jsonb_array_elements(coalesce(s.value -> 'hubs', '[]'::jsonb)) h
   where s.key = 'delivery_service' and p_latitude is not null and p_longitude is not null
     and jsonb_typeof(h -> 'latitude') = 'number' and jsonb_typeof(h -> 'longitude') = 'number'
   order by private.km_between((h ->> 'latitude')::double precision, (h ->> 'longitude')::double precision, p_latitude, p_longitude)
   limit 1;
$$;

-- The hub of the route serving an area (nearest its centre); a route without a centre: nearest the address
create or replace function private.hub_of_area(p_area text, p_latitude double precision, p_longitude double precision)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  select private.hub_nearest(coalesce((route.data ->> 'latitude')::double precision, p_latitude),
                             coalesce((route.data ->> 'longitude')::double precision, p_longitude))
    from (select (select r.data from public.panel_records r
                   where r.module = 'routes' and lower(trim(r.data ->> 'area')) = lower(trim(p_area))
                     and jsonb_typeof(r.data -> 'latitude') = 'number'
                   order by r.sort_order, r.id limit 1) as data) route;
$$;


-- 4. Pay now: a milk plan within its route's hub's limit -------------------------------------------------
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
  the_hub jsonb;
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
  -- A milk plan: within the distance limit of its route's hub (when that hub has one)
  if p_has_plan then
    the_hub := private.hub_of_area(the_address.area, the_address.latitude, the_address.longitude);
    if jsonb_typeof(the_hub -> 'limitKm') = 'number'
       and private.km_between((the_hub ->> 'latitude')::double precision, (the_hub ->> 'longitude')::double precision,
                              the_address.latitude, the_address.longitude) > (the_hub ->> 'limitKm')::double precision then
      raise exception 'This address is outside our delivery area. Please contact the farm on %.', contact using errcode = 'P0001', hint = 'address';
    end if;
  end if;
end;
$$;

revoke execute on function public.save_delivery_hub(text, text, double precision, double precision, numeric) from public, anon;
revoke execute on function public.remove_delivery_hub(text) from public, anon;
revoke execute on function public.set_delivery_hub(double precision, double precision, numeric) from public, anon;
grant execute on function public.save_delivery_hub(text, text, double precision, double precision, numeric) to authenticated;
grant execute on function public.remove_delivery_hub(text) to authenticated;
grant execute on function public.set_delivery_hub(double precision, double precision, numeric) to authenticated;
revoke execute on function private.hub_nearest(double precision, double precision) from public, anon, authenticated;
revoke execute on function private.hub_of_area(text, double precision, double precision) from public, anon, authenticated;
revoke execute on function private.check_delivery_address(text, boolean) from public, anon, authenticated;
