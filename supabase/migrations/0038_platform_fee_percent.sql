-- =====================================================================================================
-- 0038 · The platform fee on a milk plan is worked out from the plan's price
--   Platform fee = the percentage of the plan's price before any coupon + GST on that amount, worked out exactly
--   and rounded once, to the nearest paisa (money can't go smaller). New plans and "Extend Plan" pay the same way.
--   Example: a ₹10,000 plan: 2% = ₹200, 18% GST on it = ₹36: platform fee ₹236.
--   One-time items pay none (0028). A checkout still pays it once, on the plan's order.
--   The rule is one app_settings row, plan_fee_rule (only the owner changes it). The website charges the old
--   flat fee until this row is here, so apply this after the website is deployed: the row and save_order()
--   below go live together, and checkout never sees two different totals.
--   save_order() is the one the database had (0028), changed only in the milk plan's fee.
-- Safe to run again.
-- =====================================================================================================


-- 1. The rule ------------------------------------------------------------------------------------------
insert into public.app_settings (key, value, description) values
  ('plan_fee_rule', '{"percent": 2, "gstPercent": 18}',
   'Platform fee on a milk plan: percent of the price before any coupon, and the GST percent on that amount')
on conflict (key) do nothing;

-- Only the owner changes it (0012's guard, with this row added)
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
                 'delivery_product_rules', 'platform_fee_paise', 'plan_fee_rule')
     and new.value is distinct from old.value then
    raise exception 'Prices are changed only by the owner';
  end if;
  return new;
end;
$$;


-- 2. The sum (the website's planPlatformFee() does the same) --------------------------------------------
create or replace function private.plan_fee_paise(p_plan_total_paise integer)
returns integer
language plpgsql stable
set search_path = public
as $$
declare
  rule jsonb := (select value from public.app_settings where key = 'plan_fee_rule');
begin
  return round(p_plan_total_paise::numeric * (rule ->> 'percent')::numeric * (100 + (rule ->> 'gstPercent')::numeric) / 10000)::integer;
end;
$$;

revoke execute on function private.plan_fee_paise(integer) from public, anon, authenticated;


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
    -- On the plan's price before the coupon
    order_platform_paise := private.plan_fee_paise(plan_line.plan_total_paise);
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
$function$;
