-- =====================================================================================================
-- 0061 · A paid order gets its agent once its map pin arrives
--   A one-time order outside the 8 areas is given to the nearest agent by its pin (0054). At Pay now the order
--   doesn't have the pin yet: the website links it to its address just after the payment
--   (link_order_address), and that is when the pin is copied. So the agent was never chosen and the order
--   waited on "Needs an agent". Now:
--   1. link_order_address(): after copying the pin, a paid order without a stop is given its agent
--      (private.auto_assign_order, the same rules as at payment).
--   2. address_pin_to_orders(): when a pin is added or moved on an address, its paid open orders without a stop
--      are given their agent too (an order that already has a stop only has its stop's pin moved, as before).
--   Orders already waiting are not changed here (the admin gives them an agent on the Orders page).
--   No new table.
-- Safe to run again.
-- =====================================================================================================


-- 1. Linking the order to its address (just after the payment) -------------------------------------------
CREATE OR REPLACE FUNCTION public.link_order_address(p_order_number text, p_address_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
   where id = the_order.id
  returning * into the_order;
  if the_address.latitude is not null then
    perform private.pin_order_stops('#' || the_order.order_number, the_address.latitude, the_address.longitude);
  end if;
  -- Paid already: now that it has its pin, its agent (it does nothing when the order already has a stop)
  if the_order.payment_status = 'paid' and the_order.status <> 'cancelled' then
    perform private.auto_assign_order(the_order);
  end if;
  return true;
end;
$function$;


-- 2. A pin added or moved on an address ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.address_pin_to_orders()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  open_order public.orders;
begin
  if new.latitude is not distinct from old.latitude and new.longitude is not distinct from old.longitude then
    return null;
  end if;
  for open_order in
    update public.orders
       set delivery_latitude = new.latitude, delivery_longitude = new.longitude
     where address_id = new.id and status in ('placed', 'packed', 'out-for-delivery')
    returning *
  loop
    perform private.pin_order_stops('#' || open_order.order_number, new.latitude, new.longitude);
    -- Paid and still without an agent: now it has a pin, give it one
    if open_order.payment_status = 'paid' and new.latitude is not null then
      perform private.auto_assign_order(open_order);
    end if;
  end loop;
  return null;
end;
$function$;
