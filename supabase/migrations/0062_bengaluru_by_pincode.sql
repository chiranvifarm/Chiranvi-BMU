-- =====================================================================================================
-- 0062 · One-time products: Bengaluru also by its pincode
--   A cart of one-time products may go anywhere in Bengaluru (0054). That was read from the address's city
--   only, and OpenStreetMap names some Bengaluru localities as towns of their own, so an address filled from the
--   map could say City "Electronic City" and be refused. Now an address is in Bengaluru when its city says
--   Bengaluru / Bangalore, or its pincode is a Bengaluru one (560…, e.g. Electronic City 560100). Hosur (635…)
--   or Mysuru (570…) still aren't. Milk plans don't change (the 8 service areas).
--   private.is_bengaluru_address(); private.check_delivery_address() uses it. No new table.
-- Safe to run again.
-- =====================================================================================================

create or replace function private.is_bengaluru_address(city text, pincode text)
returns boolean
language sql
immutable
as $$
  select private.is_bengaluru(city) or coalesce(trim(pincode), '') ~ '^560[0-9]{3}$';
$$;

CREATE OR REPLACE FUNCTION private.check_delivery_address(p_address_id text, p_has_plan boolean)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
  -- (in Bengaluru: the city says so, or the pincode is a Bengaluru one, 560…)
  if not p_has_plan and not is_service_area and not private.is_bengaluru_address(the_address.city, the_address.pincode) then
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
$function$;

revoke execute on function private.is_bengaluru_address(text, text) from public, anon, authenticated;
revoke execute on function private.check_delivery_address(text, boolean) from public, anon, authenticated;
