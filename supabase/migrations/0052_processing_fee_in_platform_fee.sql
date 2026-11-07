-- =====================================================================================================
-- 0052 · The convenience and digital processing fee, in the platform fee
--   A milk plan's platform fee is now the percentage of its price before any coupon, GST on that amount, and a
--   convenience and digital processing fee that the customer pays: ₹500 on a new plan, ₹400 on "Extend Plan".
--   Example: a ₹10,000 plan: ₹200 + ₹36 GST + ₹500 = ₹736. GST is on the percentage only, as the accountant said.
--   The amounts are in the plan_fee_rule setting (only the owner changes it). The bill shows it as one Platform
--   fee line, with a note saying it includes this fee. Coupons are unchanged: only what a customer applies.
--   Apply after the website is deployed: it adds the amounts from this setting, so the setting and save_order()
--   go live together and checkout never sees two totals. One-time items still pay no platform fee.
--   No new table.
-- Safe to run again.
-- =====================================================================================================


-- 1. The amounts (kept if the owner has changed them) --------------------------------------------------
update public.app_settings
   set value = jsonb_build_object('extraPaise', 50000, 'extensionExtraPaise', 40000) || value
 where key = 'plan_fee_rule';


-- 2. The sum (the website's planPlatformFee() does the same) --------------------------------------------
create or replace function private.plan_fee_paise(p_plan_total_paise integer, p_is_extension boolean)
returns integer
language plpgsql stable
set search_path = public
as $$
declare
  rule jsonb := (select value from public.app_settings where key = 'plan_fee_rule');
begin
  return round(p_plan_total_paise::numeric * (rule ->> 'percent')::numeric * (100 + (rule ->> 'gstPercent')::numeric) / 10000)::integer
         + (rule ->> (case when p_is_extension then 'extensionExtraPaise' else 'extraPaise' end))::integer;
end;
$$;

revoke execute on function private.plan_fee_paise(integer, boolean) from public, anon, authenticated;


-- 3. save_order() ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.save_order(details jsonb, p_checkout_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  mobile text := public.current_mobile();
  customer public.customers;
  new_order public.orders;
  placed timestamptz := now();
  free_from_paise integer := private.setting_paise('free_delivery_from_paise', 50000);
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
  product_key text;                       -- one-time items: a product's packs count together
  product_totals jsonb := '{}'::jsonb;    -- {productKey: how many in this order}
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
    -- A new plan: up to 9 a day. Extending keeps the plan's own number, so a running plan is not refused
    if bottles_per_day > 9 and coalesce(details -> 'subscription' ->> 'extendsOrderId', '') = '' then
      raise exception 'You can add up to 9 of each item per order.' using errcode = 'P0001';
    end if;
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
    -- On the plan's price before the coupon
    order_platform_paise := private.plan_fee_paise(plan_line.plan_total_paise, coalesce(details -> 'subscription' ->> 'extendsOrderId', '') <> '');
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
      -- Up to 9 of a product in one order, all its packs together (the cart stops at 9 too)
      product_key := coalesce(line.page_slug, item ->> 'productId');
      product_totals := jsonb_set(product_totals, array[product_key], to_jsonb(coalesce((product_totals ->> product_key)::integer, 0) + quantity));
      if (product_totals ->> product_key)::integer > 9 then
        raise exception 'You can add up to 9 of each item per order.' using errcode = 'P0001';
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
    -- The platform fee is only for milk plans: one-time items pay none, alone or with a plan
    order_platform_paise := 0;
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
    private.promised_morning(placed),
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
$function$;


-- The sum without the new or extended plan isn't used any more
drop function if exists private.plan_fee_paise(integer);
