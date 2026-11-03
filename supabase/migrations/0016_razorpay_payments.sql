-- =====================================================================================================
-- 0016 · Razorpay payments (Pay now takes the money before an order counts)
--   Brought from the Razorpay copy (E:\Chiranvi_X_Razorpay, its 0012 + 0013), rebuilt on this project's
--   pricing (place_order() of 0012: the platform fee, the coupon lists per cart, the owner's delivery
--   charges). No new tables: orders get the payment columns.
--   1. orders: checkout_id (the orders paid together), razorpay_order_id, razorpay_payment_id, paid_at,
--      payment_failure_reason, and the payment status "awaiting_payment".
--   2. private.save_order(): place_order()'s pricing and saving, for one order. Without a checkout it works
--      as before (place_order(), "not charged", the coupon use counted at once); with a checkout the order is
--      saved "awaiting payment" and its coupon use waits for the payment.
--   3. start_checkout(): Pay now. Saves the milk plan and / or the one-time items as orders awaiting payment
--      (one payment for both), checks the total is the one the customer saw ("Prices have changed"
--      otherwise: nothing is saved), and removes this customer's unpaid orders older than an hour.
--   4. Our payment server only (secret key): attach_razorpay_order(), mark_checkout_paid() (also counts the
--      coupon use; safe to run twice: from the browser's confirmation and from Razorpay's webhook),
--      mark_checkout_failed() (a "Payment failed" receipt for the customer).
--   5. Who sees what: an order awaiting payment is seen by nobody; a failed payment only by its customer
--      (for the receipt); the panel sees real orders only.
--   place_order() stays callable for now, so the live site keeps working until this code is deployed; a
--   later migration takes it away from browsers (then only a payment places an order).
-- Money in paise in the tables; the website works in rupees. Safe to run again.
-- =====================================================================================================


-- 1. orders: payment details -------------------------------------------------------------------------------
alter table public.orders add column if not exists checkout_id uuid;
alter table public.orders add column if not exists razorpay_order_id text;
alter table public.orders add column if not exists razorpay_payment_id text;
alter table public.orders add column if not exists paid_at timestamptz;
alter table public.orders add column if not exists payment_failure_reason text;
create index if not exists orders_checkout_id_idx on public.orders (checkout_id);
create index if not exists orders_razorpay_order_id_idx on public.orders (razorpay_order_id);

alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check
  check (payment_status in ('not_charged', 'awaiting_payment', 'paid', 'failed', 'refunded'));


-- 2. private.save_order(): one order, priced by the database ------------------------------------------------
create or replace function private.save_order(details jsonb, p_checkout_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  mobile text := public.current_mobile();
  customer public.customers;
  new_order public.orders;
  placed timestamptz := now();
  free_from_paise integer := private.setting_paise('free_delivery_from_paise', 50000);
  platform_paise integer := private.setting_paise('platform_fee_paise', 75000);
  is_plan boolean := jsonb_typeof(details -> 'subscription') = 'object';
  comes_with_plan boolean := false;       -- one-time items placed right after their plan's order
  order_cart_type text;
  saved_items jsonb := '[]'::jsonb;       -- [{productId, name, packSize, quantity, pricePaise, item}]
  coupon_lines jsonb := '[]'::jsonb;
  delivery_lines jsonb := '[]'::jsonb;
  item jsonb;
  line record;
  plan_line record;
  quantity integer;
  items_total_paise integer := 0;
  discount_paise integer := 0;
  coupon_code text;
  delivery_paise integer := 0;
  order_platform_paise integer := 0;
  total_paise integer;
  subscription jsonb;
  bottles_per_day integer;
  saved_item jsonb;
  item_position integer := 0;
  -- With a checkout: saved awaiting payment, the coupon use counted when paid (mark_checkout_paid)
  is_paid_checkout boolean := p_checkout_id is not null;
begin
  if auth.uid() is null or coalesce(mobile, '') !~ '^\d{10}$' then
    raise exception 'Log in to place an order';
  end if;
  if jsonb_typeof(details -> 'items') is distinct from 'array' or jsonb_array_length(details -> 'items') = 0 then
    raise exception 'The order has no items';
  end if;
  if jsonb_array_length(details -> 'items') > 50 then
    raise exception 'Too many items in one order';
  end if;
  if coalesce(trim(details ->> 'deliverTo'), '') = '' then
    raise exception 'Choose a delivery address';
  end if;
  if coalesce(details ->> 'paymentMethod', 'UPI') not in ('UPI', 'Net banking', 'Card') then
    raise exception 'Choose how to pay';
  end if;

  select * into customer from public.customers where mobile_number = mobile;

  if is_plan then
    order_cart_type := case when details ->> 'cartType' = 'subscription-and-one-time' then 'subscription-and-one-time' else 'subscription' end;
  else
    comes_with_plan := exists (
      select 1 from public.orders o
      where o.order_number = details ->> 'planOrderNumber' and o.customer_mobile = mobile
        and o.subscription is not null and o.placed_at > placed - interval '15 minutes'
        and case when is_paid_checkout then o.checkout_id = p_checkout_id else o.payment_status in ('not_charged', 'paid') end);
    order_cart_type := case when comes_with_plan then 'subscription-and-one-time' else 'one-time' end;
  end if;
  -- The coupon must be in this cart's list (Coupons & offers → Coupons in the cart)
  if coalesce(trim(details ->> 'couponCode'), '') <> '' and exists (
    select 1 from public.coupons c where c.code = upper(trim(details ->> 'couponCode')) and not (order_cart_type = any (c.cart_types))) then
    raise exception '% can''t be used on this order', upper(trim(details ->> 'couponCode')) using errcode = 'P0001', hint = 'coupon';
  end if;

  if is_plan then
    -- A milk plan: one line, its price from the page's plan; free delivery
    if jsonb_array_length(details -> 'items') <> 1 then
      raise exception 'A milk plan is one product';
    end if;
    item := details -> 'items' -> 0;
    bottles_per_day := (details -> 'subscription' ->> 'bottlesPerDay')::integer;
    select * into plan_line from private.plan_price(item ->> 'productId', details -> 'subscription' ->> 'planId',
      (details -> 'subscription' ->> 'months')::integer, (details -> 'subscription' ->> 'days')::integer, bottles_per_day);
    -- Extending a plan: it must be this customer's own running plan
    if coalesce(details -> 'subscription' ->> 'extendsOrderId', '') <> '' and not exists (
      select 1 from public.orders o
      where o.order_number = details -> 'subscription' ->> 'extendsOrderId' and o.customer_mobile = mobile
        and o.subscription is not null and o.status <> 'cancelled' and o.payment_status in ('not_charged', 'paid')) then
      raise exception 'The plan to extend wasn''t found';
    end if;
    items_total_paise := plan_line.plan_total_paise;
    saved_items := jsonb_build_array(jsonb_build_object(
      'productId', item ->> 'productId', 'quantity', plan_line.bottle_count, 'pricePaise', plan_line.price_per_bottle_paise,
      'item', coalesce(item, '{}'::jsonb) || jsonb_build_object('quantity', plan_line.bottle_count,
              'price', plan_line.price_per_bottle_paise / 100.0, 'originalPrice', plan_line.unit_paise / 100.0)));
    if coalesce(trim(details ->> 'couponCode'), '') <> '' then
      select c.code, c.discount_paise into coupon_code, discount_paise
      from private.coupon_discount(details ->> 'couponCode', null, plan_line.plan_total_paise, plan_line.price_per_bottle_paise, bottles_per_day, true) c;
    end if;
    delivery_paise := 0;
    order_platform_paise := platform_paise;
    -- The plan as saved: the page's plan, with the database's price per bottle and bottle count
    subscription := jsonb_strip_nulls(jsonb_build_object(
      'planId', plan_line.plan ->> 'planId',
      'planName', plan_line.plan ->> 'label',
      'months', (plan_line.plan ->> 'months')::integer,
      'days', (plan_line.plan ->> 'days')::integer,
      'bottlesPerDay', bottles_per_day,
      'pricePerLitre', plan_line.price_per_bottle_paise / 100.0,
      'bottleCount', plan_line.bottle_count,
      'extendsOrderId', nullif(details -> 'subscription' ->> 'extendsOrderId', ''),
      'bottleLabel', case when item ->> 'productId' like '%-half-litre' then '500 ml' end,
      'unitName', case when item ->> 'productId' like '%-half-litre' then '500 ml' end));
  else
    -- One-time items: each price from the product page (or Products & pricing)
    for item in select value from jsonb_array_elements(details -> 'items') loop
      select * into line from private.cart_line(item ->> 'productId');
      if line.unit_paise is null then
        raise exception '% is no longer sold. Remove it from your cart.', coalesce(item ->> 'name', 'A product') using hint = 'unavailable';
      end if;
      if not line.is_available then
        raise exception '% is sold out right now. Remove it from your cart.', coalesce(item ->> 'name', 'A product') using hint = 'unavailable';
      end if;
      quantity := (item ->> 'quantity')::integer;
      if quantity is null or quantity < 1 or quantity > 99 then
        raise exception 'Check the quantities in your cart';
      end if;
      items_total_paise := items_total_paise + line.unit_paise * quantity;
      coupon_lines := coupon_lines || jsonb_build_array(jsonb_build_object('amountPaise', line.unit_paise * quantity, 'category', line.category));
      -- Delivery settings are kept by product: the page's slug, or the card's id for a product without a page
      delivery_lines := delivery_lines || jsonb_build_array(jsonb_build_object(
        'productKey', coalesce(line.page_slug, item ->> 'productId'), 'amountPaise', line.unit_paise * quantity));
      saved_items := saved_items || jsonb_build_array(jsonb_build_object(
        'productId', item ->> 'productId', 'quantity', quantity, 'pricePaise', line.unit_paise,
        'item', item || jsonb_build_object('quantity', quantity, 'price', line.unit_paise / 100.0, 'originalPrice', line.original_paise / 100.0)));
    end loop;
    if coalesce(trim(details ->> 'couponCode'), '') <> '' then
      select c.code, c.discount_paise into coupon_code, discount_paise
      from private.coupon_discount(details ->> 'couponCode', coupon_lines, null, null, null, true) c;
    end if;
    -- Free delivery from the set amount, or when a plan was placed just before (the items come with it);
    -- otherwise the owner's delivery settings
    if items_total_paise - discount_paise >= free_from_paise or comes_with_plan then
      delivery_paise := 0;
    else
      select d.fee_paise into delivery_paise from private.delivery_fee(delivery_lines) d;
    end if;
    -- The platform fee was paid with the plan when the items come with one
    order_platform_paise := case when comes_with_plan then 0 else platform_paise end;
  end if;

  total_paise := items_total_paise - discount_paise + delivery_paise + order_platform_paise;

  -- The customer must have seen this same total (half a rupee either way for rounding); a checkout checks
  -- the whole payment's total instead (start_checkout)
  if not is_paid_checkout and (details ->> 'total' is null or abs(round((details ->> 'total')::numeric * 100) - total_paise) > 50) then
    raise exception 'Prices have changed. Please check your cart and pay again.' using hint = 'prices';
  end if;

  insert into public.orders (
    customer_mobile, customer_id, customer_code, customer_name, area, total_paise, delivery_fee_paise, platform_fee_paise,
    coupon_code, coupon_discount_paise, payment_method, deliver_to, delivery_mobile, subscription,
    placed_at, promised_at, status_changed_at, checkout_id, payment_status)
  values (
    mobile, customer.id, customer.customer_code,
    coalesce(nullif(trim(concat_ws(' ', customer.first_name, customer.last_name)), ''), split_part(details ->> 'deliverTo', ' · ', 1)),
    coalesce(nullif(details ->> 'area', ''), customer.location, ''),
    total_paise, delivery_paise, order_platform_paise, coupon_code, case when coupon_code is not null then discount_paise end,
    coalesce(details ->> 'paymentMethod', 'UPI'),
    trim(details ->> 'deliverTo'),
    case when coalesce(details ->> 'deliveryMobile', '') ~ '^\d{10}$' then details ->> 'deliveryMobile' end,
    subscription,
    placed,
    (((placed at time zone 'Asia/Kolkata')::date + 1) + time '07:00') at time zone 'Asia/Kolkata',
    jsonb_build_object('placed', floor(extract(epoch from placed) * 1000)::bigint),
    p_checkout_id, case when is_paid_checkout then 'awaiting_payment' else 'not_charged' end)
  returning * into new_order;

  for saved_item in select value from jsonb_array_elements(saved_items) loop
    item_position := item_position + 1;
    insert into public.order_items (order_id, position, product_id, name, pack_size, quantity, price_paise, item)
    values (new_order.id, item_position, saved_item ->> 'productId', coalesce(saved_item -> 'item' ->> 'name', ''),
            coalesce(saved_item -> 'item' ->> 'packSize', ''), (saved_item ->> 'quantity')::integer,
            (saved_item ->> 'pricePaise')::integer, saved_item -> 'item');
  end loop;

  -- The coupon use: one more use, and a row for the Coupons & offers page (a checkout: once paid)
  if coupon_code is not null and not is_paid_checkout then
    update public.coupons set used = used + 1 where code = coupon_code;
    insert into public.coupon_redemptions (code, order_id, order_number, customer_name, area, discount_paise, order_value_paise)
    values (coupon_code, new_order.id, new_order.order_number, new_order.customer_name, new_order.area, discount_paise, items_total_paise);
  end if;

  return jsonb_build_object(
    'orderNumber', new_order.order_number,
    'placedAt', floor(extract(epoch from new_order.placed_at) * 1000)::bigint,
    'promisedAt', floor(extract(epoch from new_order.promised_at) * 1000)::bigint,
    'customerName', new_order.customer_name,
    'customerCode', new_order.customer_code,
    'area', new_order.area,
    'kind', case when is_plan then 'plan' else 'items' end,
    'total', total_paise / 100.0,
    'totalPaise', total_paise,
    'deliveryFee', delivery_paise / 100.0,
    'platformFee', order_platform_paise / 100.0,
    'couponCode', coupon_code,
    'couponDiscount', case when coupon_code is not null then discount_paise / 100.0 end,
    'items', (select jsonb_agg(value -> 'item') from jsonb_array_elements(saved_items)),
    'subscription', subscription);
end;
$$;

-- place_order(): as before (no payment), for the website until it uses Razorpay everywhere
create or replace function public.place_order(details jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  return private.save_order(details, null);
end;
$$;


-- 3. start_checkout(): Pay now saves the order(s), awaiting payment ------------------------------------------
-- details: {planOrder, itemsOrder, shownTotal}: planOrder and itemsOrder are place_order()'s details (either
-- may be null; the items get free delivery and no platform fee when a plan comes with them), shownTotal is
-- the amount the customer saw (₹). Answers {checkoutId, amountPaise, orders: [save_order()'s answers]}.
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

  return jsonb_build_object('checkoutId', checkout, 'amountPaise', total_paise, 'orders', answers);
end;
$$;


-- 4. Our payment server only (secret key) --------------------------------------------------------------------
create or replace function public.attach_razorpay_order(p_checkout_id uuid, p_razorpay_order_id text)
returns void
language sql security definer
set search_path = public
as $$
  update public.orders set razorpay_order_id = p_razorpay_order_id
  where checkout_id = p_checkout_id and payment_status = 'awaiting_payment';
$$;

-- An order as the website shows it after paying (the same fields as save_order()'s answer)
create or replace function private.order_answer(saved public.orders)
returns jsonb
language sql stable
set search_path = public
as $$
  select jsonb_build_object(
    'kind', case when saved.subscription is not null then 'plan' else 'items' end,
    'orderNumber', saved.order_number,
    'placedAt', floor(extract(epoch from saved.placed_at) * 1000)::bigint,
    'promisedAt', floor(extract(epoch from saved.promised_at) * 1000)::bigint,
    'paidAt', case when saved.paid_at is not null then floor(extract(epoch from saved.paid_at) * 1000)::bigint end,
    'paymentStatus', saved.payment_status,
    'razorpayPaymentId', saved.razorpay_payment_id,
    'customerName', saved.customer_name,
    'customerCode', saved.customer_code,
    'area', saved.area,
    'total', saved.total_paise / 100.0,
    'totalPaise', saved.total_paise,
    'deliveryFee', saved.delivery_fee_paise / 100.0,
    'platformFee', saved.platform_fee_paise / 100.0,
    'couponCode', saved.coupon_code,
    'couponDiscount', case when saved.coupon_code is not null then saved.coupon_discount_paise / 100.0 end,
    'items', (select jsonb_agg(oi.item order by oi.position) from public.order_items oi where oi.order_id = saved.id),
    'subscription', saved.subscription);
$$;

/*
  Razorpay took the money (the signature or the webhook checked by our server): the order(s) become paid and
  placed now (so tomorrow's delivery counts from the payment), and each coupon gets its use and redemption.
  Running it again for the same payment changes nothing and answers the same orders.
*/
create or replace function public.mark_checkout_paid(p_razorpay_order_id text, p_razorpay_payment_id text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  paid_order public.orders;
  placed timestamptz := now();
  promised timestamptz := (((now() at time zone 'Asia/Kolkata')::date + 1) + time '07:00') at time zone 'Asia/Kolkata';
begin
  if coalesce(p_razorpay_order_id, '') = '' or not exists (select 1 from public.orders where razorpay_order_id = p_razorpay_order_id) then
    raise exception 'No order for this payment';
  end if;
  for paid_order in
    update public.orders
       set payment_status = 'paid', razorpay_payment_id = p_razorpay_payment_id, paid_at = placed,
           payment_failure_reason = null, placed_at = placed, promised_at = promised,
           status_changed_at = jsonb_build_object('placed', floor(extract(epoch from placed) * 1000)::bigint)
     where razorpay_order_id = p_razorpay_order_id and payment_status in ('awaiting_payment', 'failed')
    returning *
  loop
    if paid_order.coupon_code is not null and exists (select 1 from public.coupons where code = paid_order.coupon_code) then
      update public.coupons set used = used + 1 where code = paid_order.coupon_code;
      insert into public.coupon_redemptions (code, order_id, order_number, customer_name, area, discount_paise, order_value_paise)
      values (paid_order.coupon_code, paid_order.id, paid_order.order_number, paid_order.customer_name, paid_order.area,
              coalesce(paid_order.coupon_discount_paise, 0),
              paid_order.total_paise - paid_order.delivery_fee_paise - paid_order.platform_fee_paise + coalesce(paid_order.coupon_discount_paise, 0));
    end if;
  end loop;

  return (select jsonb_agg(private.order_answer(o) order by o.subscription is null)
          from public.orders o where o.razorpay_order_id = p_razorpay_order_id);
end;
$$;

-- Razorpay says the payment failed (asked by our server, never taken from the browser): a "Payment failed" receipt
create or replace function public.mark_checkout_failed(p_razorpay_order_id text, p_razorpay_payment_id text, p_reason text)
returns integer
language sql security definer
set search_path = public
as $$
  with failed as (
    update public.orders
       set payment_status = 'failed', razorpay_payment_id = p_razorpay_payment_id,
           payment_failure_reason = left(coalesce(nullif(trim(p_reason), ''), 'The payment did not go through'), 300)
     where razorpay_order_id = p_razorpay_order_id and payment_status = 'awaiting_payment'
    returning 1
  )
  select count(*)::integer from failed;
$$;


-- 5. Who sees what --------------------------------------------------------------------------------------------
-- Customers see their own orders, including failed payments (for the receipt); staff see real orders only
drop policy if exists "Own or staff read orders" on public.orders;
create policy "Own or staff read orders" on public.orders for select
  using (payment_status <> 'awaiting_payment'
         and (customer_mobile = (select public.current_mobile())
              or (payment_status <> 'failed' and (select public.has_permission('orders', 'view')))));

revoke execute on function public.start_checkout(jsonb) from public, anon;
grant execute on function public.start_checkout(jsonb) to authenticated;
revoke execute on function public.attach_razorpay_order(uuid, text), public.mark_checkout_paid(text, text),
  public.mark_checkout_failed(text, text, text) from public, anon, authenticated;
grant execute on function public.attach_razorpay_order(uuid, text), public.mark_checkout_paid(text, text),
  public.mark_checkout_failed(text, text, text) to service_role;
