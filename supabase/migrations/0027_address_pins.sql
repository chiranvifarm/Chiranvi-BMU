-- =====================================================================================================
-- 0027 · A map pin on each address (exact location for the delivery agent)
--   A pin is two numbers, latitude and longitude, from the phone's GPS (never typed). The agent's
--   "Navigate in Google Maps" goes to the pin instead of guessing from the address text.
--   1. addresses: latitude, longitude, who saved the pin (customer / agent) and when. The customer saves it
--      with "Use my current location" on the address form (their own address rules, 0009). Pins outside
--      India are refused.
--   2. orders: address_id (the address it is delivered to) and a copy of its pin.
--      link_order_address(order, address): called by the website just after payment. Only the customer's own
--      order and their own address; the pin is copied from the address as the database has it (not from
--      the browser). An order is linked once, before it goes out.
--   3. An address's pin changes: its open orders and their open stops (panel_records, "deliveries") get the
--      new pin too.
--   4. save_stop_location(stop, latitude, longitude): the agent at the gate. Only the stop's own agent (their
--      number is on it), on today's stop, or staff who may change Deliveries. Only the pin changes: the
--      customer's address (so every later delivery is exact), its order and the stop. An order made in the
--      panel has no address: the pin goes on the stop only.
--   No new table.
-- Safe to run again.
-- =====================================================================================================


-- 1. The address's pin ------------------------------------------------------------------------------
alter table public.addresses
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists pin_saved_by text,
  add column if not exists pin_saved_at timestamptz;

-- Both numbers or neither, inside India, and who saved it
alter table public.addresses drop constraint if exists addresses_pin_check;
alter table public.addresses add constraint addresses_pin_check check (
  (latitude is null and longitude is null)
  or (latitude is not null and longitude is not null
      and latitude between 6 and 37.5 and longitude between 68 and 97.5)
);
alter table public.addresses drop constraint if exists addresses_pin_saved_by_check;
alter table public.addresses add constraint addresses_pin_saved_by_check check (pin_saved_by is null or pin_saved_by in ('customer', 'agent'));

-- Who saved the pin and when: written here, not by the browser (the agent's step below writes its own)
create or replace function public.stamp_address_pin()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if tg_op = 'INSERT' or new.latitude is distinct from old.latitude or new.longitude is distinct from old.longitude then
    new.pin_saved_by := case when new.latitude is null then null else 'customer' end;
    new.pin_saved_at := case when new.latitude is null then null else now() end;
  else
    new.pin_saved_by := old.pin_saved_by;
    new.pin_saved_at := old.pin_saved_at;
  end if;
  return new;
end;
$$;

drop trigger if exists addresses_stamp_pin on public.addresses;
create trigger addresses_stamp_pin
  before insert or update on public.addresses
  for each row execute function public.stamp_address_pin();


-- 2. The order's address and pin --------------------------------------------------------------------
alter table public.orders
  add column if not exists address_id uuid references public.addresses (id) on delete set null,  -- address removed: the pin copy stays
  add column if not exists delivery_latitude double precision,
  add column if not exists delivery_longitude double precision;

create index if not exists orders_address_id_idx on public.orders (address_id) where address_id is not null;

-- The pin on the open stops of an order ("#CF-60085" is order CF-60085)
create or replace function private.pin_order_stops(stop_order_number text, pin_latitude double precision, pin_longitude double precision)
returns void
language sql security definer
set search_path = public
as $$
  update public.panel_records
     set data = case when pin_latitude is null then data - 'latitude' - 'longitude'
                     else data || jsonb_build_object('latitude', pin_latitude, 'longitude', pin_longitude) end
   where module = 'deliveries'
     and data ->> 'orderNumber' = stop_order_number
     and coalesce(data ->> 'status', '') in ('Pending', 'Out for delivery');
$$;

revoke execute on function private.pin_order_stops(text, double precision, double precision) from public, anon, authenticated;

create or replace function public.link_order_address(p_order_number text, p_address_id uuid)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  me text := (select public.current_mobile());
  the_address public.addresses;
  the_order public.orders;
begin
  if auth.uid() is null or coalesce(me, '') !~ '^\d{10}$' then
    raise exception 'Log in first' using errcode = '42501';
  end if;
  select * into the_order from public.orders where order_number = p_order_number and customer_mobile = me;
  select a.* into the_address from public.addresses a
    join public.customers c on c.id = a.customer_id
   where a.id = p_address_id and c.user_id = auth.uid();
  if the_order.id is null or the_address.id is null then
    raise exception 'Not your order or address' using errcode = '42501';
  end if;
  -- Linked once, before it goes out
  if the_order.address_id is not null or the_order.status not in ('placed', 'packed') then
    return false;
  end if;
  update public.orders
     set address_id = the_address.id, delivery_latitude = the_address.latitude, delivery_longitude = the_address.longitude
   where id = the_order.id;
  if the_address.latitude is not null then
    perform private.pin_order_stops('#' || the_order.order_number, the_address.latitude, the_address.longitude);
  end if;
  return true;
end;
$$;

revoke execute on function public.link_order_address(text, uuid) from public, anon;
grant execute on function public.link_order_address(text, uuid) to authenticated;


-- 3. A new pin reaches the address's open orders and their open stops ---------------------------------
create or replace function public.address_pin_to_orders()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  open_order record;
begin
  if new.latitude is not distinct from old.latitude and new.longitude is not distinct from old.longitude then
    return null;
  end if;
  for open_order in
    update public.orders
       set delivery_latitude = new.latitude, delivery_longitude = new.longitude
     where address_id = new.id and status in ('placed', 'packed', 'out-for-delivery')
    returning order_number
  loop
    perform private.pin_order_stops('#' || open_order.order_number, new.latitude, new.longitude);
  end loop;
  return null;
end;
$$;

drop trigger if exists addresses_pin_to_orders on public.addresses;
create trigger addresses_pin_to_orders
  after update of latitude, longitude on public.addresses
  for each row execute function public.address_pin_to_orders();


-- 4. The agent saves the spot at the gate -------------------------------------------------------------
create or replace function public.save_stop_location(stop_id text, pin_latitude double precision, pin_longitude double precision)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  me text := (select public.current_mobile());
  stop_data jsonb;
  stop_owner text;
  is_staff boolean := (select public.has_permission('deliveries', 'edit'));
  the_order public.orders;
begin
  if pin_latitude is null or pin_longitude is null
     or pin_latitude not between 6 and 37.5 or pin_longitude not between 68 and 97.5 then
    raise exception 'That location is not in India' using errcode = '22023';
  end if;
  select data, owner_mobile into stop_data, stop_owner
    from public.panel_records where module = 'deliveries' and id = stop_id;
  if stop_data is null then
    raise exception 'Stop not found' using errcode = 'P0002';
  end if;
  if not is_staff then
    if me is null or stop_owner is distinct from me or (select public.current_staff_role()) is distinct from 'delivery-agent' then
      raise exception 'Not your stop' using errcode = '42501';
    end if;
    if stop_data ->> 'date' is distinct from private.india_today_key() then
      raise exception 'Only today''s stops' using errcode = '42501';
    end if;
  end if;

  -- The stop itself (whatever its step)
  update public.panel_records
     set data = data || jsonb_build_object('latitude', pin_latitude, 'longitude', pin_longitude)
   where module = 'deliveries' and id = stop_id;

  -- A website order: its pin, and its address's (the address's other open orders follow, 3.)
  select * into the_order from public.orders where '#' || order_number = stop_data ->> 'orderNumber';
  if the_order.id is null then
    return 'stop';
  end if;
  update public.orders set delivery_latitude = pin_latitude, delivery_longitude = pin_longitude where id = the_order.id;
  if the_order.address_id is null then
    return 'stop';
  end if;
  update public.addresses
     set latitude = pin_latitude, longitude = pin_longitude, pin_saved_by = 'agent', pin_saved_at = now()
   where id = the_order.address_id;
  return 'address';
end;
$$;

revoke execute on function public.save_stop_location(text, double precision, double precision) from public, anon;
grant execute on function public.save_stop_location(text, double precision, double precision) to authenticated;
