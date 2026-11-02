-- =====================================================================================================
-- 0012 · Delivery charges set by the owner, the platform fee, and which carts a coupon is for
--   No new tables: the settings are more rows in app_settings, and coupons / orders get one column each.
--   1. app_settings (owner only, like prices; everyone may read them, the cart shows the charge):
--        delivery_fee_paise, free_delivery_from_paise   (already there) the overall charge, free from
--        delivery_combine_rule          'highest' | 'sum' | 'fixed': a cart whose products' charges differ
--        delivery_mixed_cart_fee_paise  with 'fixed': the charge when the products' charges differ
--        delivery_product_rules         each product's own setting, by product (page slug / card id):
--                                         {"a2-desi-ghee": {"mode": "free"},
--                                          "fresh-cow-paneer": {"mode": "own" | "offer-lower", "feePaise": 2000},
--                                          "jersey-butter": {"mode": "offer-free-above", "freeAbovePaise": 40000}}
--                                       a product not listed pays the overall charge
--        platform_fee_paise             once per checkout (with the milk plan's order when there is one)
--   2. coupons.cart_types: the carts a coupon works in ('one-time', 'subscription',
--      'subscription-and-one-time'), chosen on Coupons & offers → Coupons in the cart. Empty: none.
--      orders.platform_fee_paise: the platform fee in that order's total.
--   3. private.delivery_fee(): the charge for a cart's one-time lines, by the owner's settings
--   4. save_delivery_settings(): the owner saves the "Set delivery charge" pop-up
--   5. check_coupon() and cart_coupons(): only codes in this cart's list; cart_coupons() is the cart's
--      coupon drop-down (each code with whether it works on this cart)
--   6. place_order() again (0011's, plus): the delivery charge from these settings, the platform fee, and
--      the coupon must be in the cart's list. The total must still be the one the customer saw.
-- Safe to run again.
-- =====================================================================================================


-- 1. Settings -------------------------------------------------------------------------------------------
insert into public.app_settings (key, value, description) values
  ('delivery_combine_rule', '"highest"', 'A cart whose products have different delivery charges pays: highest, sum (added up) or fixed'),
  ('delivery_mixed_cart_fee_paise', '4000', 'With the fixed rule: the delivery charge (in paise) when a cart''s products have different charges'),
  ('delivery_product_rules', '{}', 'Products with their own delivery setting (free, own charge, offers); the others pay the overall charge'),
  ('platform_fee_paise', '75000', 'Platform fee once per checkout (in paise: 75000 = ₹750); not counted for free delivery or coupons')
on conflict (key) do nothing;

-- Money settings change only by the owner (0011 guarded the first two)
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
                 'delivery_product_rules', 'platform_fee_paise')
     and new.value is distinct from old.value then
    raise exception 'Prices are changed only by the owner';
  end if;
  return new;
end;
$$;


-- 2. Columns --------------------------------------------------------------------------------------------
alter table public.coupons add column if not exists cart_types text[] not null default '{}';
alter table public.coupons drop constraint if exists coupons_cart_types_check;
alter table public.coupons add constraint coupons_cart_types_check
  check (cart_types <@ array['one-time', 'subscription', 'subscription-and-one-time']::text[]);

alter table public.orders add column if not exists platform_fee_paise integer not null default 0 check (platform_fee_paise >= 0);


-- A setting in paise (or the given amount when it's missing)
create or replace function private.setting_paise(p_key text, p_default integer)
returns integer
language sql stable
set search_path = public
as $$
  select coalesce((select round((value #>> '{}')::numeric)::integer from public.app_settings where key = p_key), p_default);
$$;


-- 3. The delivery charge for a cart's one-time lines -----------------------------------------------------
-- lines: [{"productKey": "a2-desi-ghee", "amountPaise": 30000}, …] (packs of one product count together).
-- Answers fee_paise, and fee_before_offers_paise: the same without offers (the cart shows it crossed out).
-- Free delivery from the free amount or with a milk plan is decided by place_order, not here.
create or replace function private.delivery_fee(p_lines jsonb)
returns table (fee_paise integer, fee_before_offers_paise integer)
language plpgsql stable
set search_path = public
as $$
declare
  standard integer := private.setting_paise('delivery_fee_paise', 3000);
  mixed integer := private.setting_paise('delivery_mixed_cart_fee_paise', 4000);
  rule text := coalesce((select value #>> '{}' from public.app_settings where key = 'delivery_combine_rule'), 'highest');
  rules jsonb := coalesce((select value from public.app_settings where key = 'delivery_product_rules'), '{}'::jsonb);
  product record;
  setting jsonb;
  fees integer[] := '{}';
  fees_before integer[] := '{}';
  this_fee integer;
  this_before integer;
begin
  for product in
    select line ->> 'productKey' as product_key, sum((line ->> 'amountPaise')::integer) as total_paise
    from jsonb_array_elements(p_lines) as line group by 1
  loop
    setting := rules -> product.product_key;
    this_fee := standard;
    this_before := standard;
    if setting ->> 'mode' = 'free' then
      this_fee := 0;
      this_before := 0;
    elsif setting ->> 'mode' = 'own' then
      this_fee := coalesce((setting ->> 'feePaise')::integer, standard);
      this_before := this_fee;
    elsif setting ->> 'mode' = 'offer-lower' then
      this_fee := coalesce((setting ->> 'feePaise')::integer, standard);
    elsif setting ->> 'mode' = 'offer-free-above' and product.total_paise >= coalesce((setting ->> 'freeAbovePaise')::integer, 2147483647) then
      this_fee := 0;
    end if;
    fees := fees || this_fee;
    fees_before := fees_before || this_before;
  end loop;

  -- highest: the biggest charge; sum: all added up; fixed: their one charge when they agree, else the fixed one
  fee_paise := case
    when coalesce(array_length(fees, 1), 0) = 0 then 0
    when rule = 'sum' then (select sum(f) from unnest(fees) f)
    when rule = 'fixed' then case when (select count(distinct f) from unnest(fees) f) = 1 then fees[1] else mixed end
    else (select max(f) from unnest(fees) f) end;
  fee_before_offers_paise := case
    when coalesce(array_length(fees_before, 1), 0) = 0 then 0
    when rule = 'sum' then (select sum(f) from unnest(fees_before) f)
    when rule = 'fixed' then case when (select count(distinct f) from unnest(fees_before) f) = 1 then fees_before[1] else mixed end
    else (select max(f) from unnest(fees_before) f) end;
  return next;
end;
$$;


-- 4. save_delivery_settings(): the owner saves the pop-up --------------------------------------------------
-- details (rupees): {fee, freeFrom, combineRule, mixedFee,
--                    products: [{productId, mode: 'standard'|'free'|'own'|'offer-lower'|'offer-free-above', fee, freeAbove}]}
-- ('standard' = pays the overall charge, so it isn't kept). All saved together, or nothing.
create or replace function public.save_delivery_settings(details jsonb)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  item jsonb;
  rules jsonb := '{}'::jsonb;
  item_fee numeric;
  item_free_above numeric;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can change delivery charges';
  end if;
  if coalesce((details ->> 'fee')::numeric, -1) not between 0 and 10000
     or coalesce((details ->> 'freeFrom')::numeric, -1) not between 0 and 1000000
     or coalesce((details ->> 'mixedFee')::numeric, -1) not between 0 and 10000 then
    raise exception 'Delivery charges must be between ₹0 and ₹10,000';
  end if;
  if coalesce(details ->> 'combineRule', '') not in ('highest', 'sum', 'fixed') then
    raise exception 'Choose how different delivery charges are combined';
  end if;
  if jsonb_array_length(coalesce(details -> 'products', '[]'::jsonb)) > 500 then
    raise exception 'Too many products';
  end if;

  for item in select value from jsonb_array_elements(coalesce(details -> 'products', '[]'::jsonb)) loop
    if coalesce(item ->> 'mode', 'standard') = 'standard' then
      continue;
    end if;
    if coalesce(item ->> 'productId', '') !~ '^[a-z0-9-]{1,80}$' then
      raise exception 'A product in the list could not be read';
    end if;
    item_fee := (item ->> 'fee')::numeric;
    item_free_above := (item ->> 'freeAbove')::numeric;
    if item ->> 'mode' = 'free' then
      rules := rules || jsonb_build_object(item ->> 'productId', jsonb_build_object('mode', 'free'));
    elsif item ->> 'mode' in ('own', 'offer-lower') and item_fee between 0 and 10000 then
      rules := rules || jsonb_build_object(item ->> 'productId',
        jsonb_build_object('mode', item ->> 'mode', 'feePaise', round(item_fee * 100)::integer));
    elsif item ->> 'mode' = 'offer-free-above' and item_free_above between 0 and 1000000 then
      rules := rules || jsonb_build_object(item ->> 'productId',
        jsonb_build_object('mode', 'offer-free-above', 'freeAbovePaise', round(item_free_above * 100)::integer));
    else
      raise exception 'Check the delivery setting of %', item ->> 'productId';
    end if;
  end loop;

  update public.app_settings set value = case key
      when 'delivery_fee_paise' then to_jsonb(round((details ->> 'fee')::numeric * 100)::integer)
      when 'free_delivery_from_paise' then to_jsonb(round((details ->> 'freeFrom')::numeric * 100)::integer)
      when 'delivery_combine_rule' then to_jsonb(details ->> 'combineRule')
      when 'delivery_mixed_cart_fee_paise' then to_jsonb(round((details ->> 'mixedFee')::numeric * 100)::integer)
      when 'delivery_product_rules' then rules
    end,
    updated_by = auth.uid()
  where key in ('delivery_fee_paise', 'free_delivery_from_paise', 'delivery_combine_rule', 'delivery_mixed_cart_fee_paise', 'delivery_product_rules');
end;
$$;


-- 5a. check_coupon(): as in 0011, but only a code in this cart's list ------------------------------------
-- The cart's type: only one-time items, only a milk plan, or a plan with one-time items.
create or replace function private.cart_type(cart jsonb)
returns text
language sql immutable
as $$
  select case
    when jsonb_typeof(cart -> 'plan') is distinct from 'object' then 'one-time'
    when jsonb_array_length(coalesce(cart -> 'items', '[]'::jsonb)) > 0 then 'subscription-and-one-time'
    else 'subscription' end;
$$;

create or replace function public.check_coupon(code text, cart jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  lines jsonb := '[]'::jsonb;
  item jsonb;
  line record;
  plan_line record;
  result record;
  plan_error text;
  typed_code text := upper(trim(coalesce(code, '')));
begin
  if auth.uid() is null then
    return jsonb_build_object('error', 'Log in to use a coupon');
  end if;
  if typed_code = '' then
    return jsonb_build_object('error', 'Enter a coupon code');
  end if;
  -- A code the owner didn't put in this cart's list
  if exists (select 1 from public.coupons c where c.code = typed_code and not (private.cart_type(cart) = any (c.cart_types))) then
    return jsonb_build_object('error', typed_code || ' can''t be used on this order');
  end if;
  for item in select value from jsonb_array_elements(coalesce(cart -> 'items', '[]'::jsonb)) limit 50 loop
    select * into line from private.cart_line(item ->> 'productId');
    if line.unit_paise is not null then
      lines := lines || jsonb_build_array(jsonb_build_object(
        'amountPaise', line.unit_paise * greatest(1, least(99, coalesce((item ->> 'quantity')::integer, 1))),
        'category', line.category));
    end if;
  end loop;

  if jsonb_typeof(cart -> 'plan') = 'object' then
    begin
      select * into plan_line from private.plan_price(cart -> 'plan' ->> 'productId', cart -> 'plan' ->> 'planId',
                                                     (cart -> 'plan' ->> 'months')::integer, (cart -> 'plan' ->> 'days')::integer,
                                                     (cart -> 'plan' ->> 'bottlesPerDay')::integer);
      select * into result from private.coupon_discount(typed_code, null, plan_line.plan_total_paise, plan_line.price_per_bottle_paise,
                                                        (cart -> 'plan' ->> 'bottlesPerDay')::integer);
      return jsonb_build_object('code', result.code, 'discount', result.discount_paise / 100.0, 'isForPlan', true,
        'description', (select c.description from public.coupons c where c.code = result.code));
    exception when sqlstate 'P0001' then
      plan_error := sqlerrm;
    end;
    if jsonb_array_length(lines) = 0 then
      return jsonb_build_object('error', plan_error);
    end if;
  end if;

  begin
    select * into result from private.coupon_discount(typed_code, lines, null, null, null);
    return jsonb_build_object('code', result.code, 'discount', result.discount_paise / 100.0, 'isForPlan', false,
      'description', (select c.description from public.coupons c where c.code = result.code));
  exception when sqlstate 'P0001' then
    return jsonb_build_object('error', coalesce(plan_error, sqlerrm));
  end;
end;
$$;


-- 5b. cart_coupons(): the cart's coupon drop-down ----------------------------------------------------------
-- The running coupons in this cart's list (not paused, started, not ended or used up), each with
-- check_coupon()'s answer on this cart: {code, description, error} (error null: it works). Logged-in only;
-- other codes stay private.
create or replace function public.cart_coupons(cart jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  answer jsonb := '[]'::jsonb;
  listed public.coupons;
  checked jsonb;
begin
  if auth.uid() is null then
    return answer;
  end if;
  for listed in
    select * from public.coupons c
    where private.cart_type(cart) = any (c.cart_types) and not c.is_paused and c.valid_from <= today
      and (c.valid_till is null or c.valid_till >= today) and (c.usage_limit is null or c.used < c.usage_limit)
    order by c.created_at desc
    limit 30
  loop
    checked := public.check_coupon(listed.code, cart);
    answer := answer || jsonb_build_array(jsonb_build_object(
      'code', listed.code, 'description', listed.description, 'error', checked ->> 'error'));
  end loop;
  return answer;
end;
$$;


-- 6. place_order(): 0011's, with the owner's delivery charges, the platform fee and the coupon lists -------
-- details as in 0011, plus cartType for a milk plan's order: 'subscription' (only the plan) or
-- 'subscription-and-one-time' (items follow in the same checkout). One-time items' own order is
-- 'subscription-and-one-time' when its planOrderNumber is a plan this customer just placed, else 'one-time'.
-- Platform fee: once per checkout, on the plan's order when there is one.
create or replace function public.place_order(details jsonb)
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
        and o.subscription is not null and o.placed_at > placed - interval '15 minutes');
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
        and o.subscription is not null and o.status <> 'cancelled') then
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

  -- The customer must have seen this same total (half a rupee either way for rounding)
  if details ->> 'total' is null or abs(round((details ->> 'total')::numeric * 100) - total_paise) > 50 then
    raise exception 'Prices have changed. Please check your cart and pay again.' using hint = 'prices';
  end if;

  insert into public.orders (
    customer_mobile, customer_id, customer_code, customer_name, area, total_paise, delivery_fee_paise, platform_fee_paise,
    coupon_code, coupon_discount_paise, payment_method, deliver_to, delivery_mobile, subscription,
    placed_at, promised_at, status_changed_at)
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
    jsonb_build_object('placed', floor(extract(epoch from placed) * 1000)::bigint))
  returning * into new_order;

  for saved_item in select value from jsonb_array_elements(saved_items) loop
    item_position := item_position + 1;
    insert into public.order_items (order_id, position, product_id, name, pack_size, quantity, price_paise, item)
    values (new_order.id, item_position, saved_item ->> 'productId', coalesce(saved_item -> 'item' ->> 'name', ''),
            coalesce(saved_item -> 'item' ->> 'packSize', ''), (saved_item ->> 'quantity')::integer,
            (saved_item ->> 'pricePaise')::integer, saved_item -> 'item');
  end loop;

  -- The coupon use: one more use, and a row for the Coupons & offers page
  if coupon_code is not null then
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
    'total', total_paise / 100.0,
    'deliveryFee', delivery_paise / 100.0,
    'platformFee', order_platform_paise / 100.0,
    'couponCode', coupon_code,
    'couponDiscount', case when coupon_code is not null then discount_paise / 100.0 end,
    'items', (select jsonb_agg(value -> 'item') from jsonb_array_elements(saved_items)),
    'subscription', subscription);
end;
$$;


-- Who may call what: the owner's save and the coupon drop-down need a login
revoke execute on function public.save_delivery_settings(jsonb), public.cart_coupons(jsonb) from public, anon;
grant execute on function public.save_delivery_settings(jsonb), public.cart_coupons(jsonb) to authenticated;
revoke execute on function public.place_order(jsonb), public.check_coupon(text, jsonb) from public, anon;
grant execute on function public.place_order(jsonb), public.check_coupon(text, jsonb) to authenticated;
