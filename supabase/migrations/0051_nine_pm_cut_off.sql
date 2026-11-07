-- =====================================================================================================
-- 0051 · The 9 PM cut-off, and stops on their real delivery day
--   1. An order paid before 9 PM (India time) is delivered the next morning; paid at 9 PM or later, the morning
--      after that: paid 8 Nov at 9 PM, delivered 10 Nov by 7 AM. private.promised_morning() is the rule, and
--      save_order() and mark_checkout_paid() use it. The website's milk page already says the same.
--   2. A milk plan starts on that morning and keeps all its days. Everything worked out from "the day after it was
--      paid" now asks private.day_before_first_delivery(), which comes from the saved promise. An order already
--      placed was promised the morning after it was paid, so its dates don't change.
--   3. An order's stop (0050) is dated its delivery morning, so the agent has it on that day's list.
--   4. create_todays_plan_stops() also brings one-time stops not finished on an earlier day to today. It runs
--      when an agent or the panel opens the day, so nobody has to open the Orders page first.
--   No new table.
-- Safe to run again.
-- =====================================================================================================


-- 1. The rule ------------------------------------------------------------------------------------------
create or replace function private.promised_morning(paid_at timestamptz)
returns timestamptz
language sql stable
as $$
  select (((paid_at at time zone 'Asia/Kolkata')::date
           + case when extract(hour from paid_at at time zone 'Asia/Kolkata') >= 21 then 2 else 1 end)
          + time '07:00') at time zone 'Asia/Kolkata';
$$;

-- The day before an order's first delivery: a plan's days are counted from here
create or replace function private.day_before_first_delivery(plan public.orders)
returns date
language sql stable
as $$
  select (plan.promised_at at time zone 'Asia/Kolkata')::date - 1;
$$;

revoke execute on function private.promised_morning(timestamptz), private.day_before_first_delivery(public.orders) from public, anon, authenticated;


-- 2. A new order's promise ----------------------------------------------------------------------------
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


-- A paid order's promise ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_checkout_paid(p_razorpay_order_id text, p_razorpay_payment_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  paid_order public.orders;
  placed timestamptz := now();
  promised timestamptz := private.promised_morning(now());
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
$function$;


-- A plan's days count from its first delivery ---------------------------------------------------------
CREATE OR REPLACE FUNCTION private.plan_last_day(plan orders)
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select private.day_before_first_delivery(plan)
         + coalesce((plan.subscription ->> 'days')::integer, 0)
         + coalesce((plan.subscription ->> 'pausedDays')::integer, 0)
         + coalesce((select sum((e.subscription ->> 'days')::integer)::integer from public.orders e
                      where e.subscription ->> 'extendsOrderId' = plan.order_number and e.status <> 'cancelled'
                        and e.payment_status in ('paid', 'not_charged')), 0);
$function$;

CREATE OR REPLACE FUNCTION private.plan_share_today(p_card_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  keys text[] := private.stock_keys_of(p_card_id);
  plan public.orders;
  plan_product text;
  answer jsonb := '{}'::jsonb;
begin
  for plan in
    select * from public.orders o
     where o.subscription is not null and o.status <> 'cancelled' and not (o.subscription ? 'extendsOrderId')
       and o.payment_status in ('not_charged', 'paid')
  loop
    continue when today <= private.day_before_first_delivery(plan) or today > private.plan_last_day(plan);
    continue when exists (
      select 1 from public.panel_records p
       where p.module = 'pause-requests' and p.data ->> 'status' = 'Approved' and p.data ->> 'websiteOrderId' = plan.order_number
         and today >= ((p.data ->> 'pauseFrom')::timestamptz at time zone 'Asia/Kolkata')::date
         and today < ((p.data ->> 'resumeOn')::timestamptz at time zone 'Asia/Kolkata')::date);
    select i.product_id into plan_product from public.order_items i where i.order_id = plan.id order by i.position limit 1;
    continue when plan_product is null or not (plan_product = any (keys));
    answer := answer || jsonb_build_object(plan_product,
      coalesce((answer ->> plan_product)::integer, 0) + coalesce((plan.subscription ->> 'bottlesPerDay')::integer, 1));
  end loop;
  return answer;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_plan_day_delivered(plan_order text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me text := private.current_delivery_agent();
  today date := (now() at time zone 'Asia/Kolkata')::date;
  today_key text := to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD');
  plan public.orders;
  last_stop public.panel_records;
  today_stop text;
  last_day date;
begin
  select * into plan from public.orders where order_number = plan_order and subscription is not null and status <> 'cancelled' for update;
  select * into last_stop from public.panel_records
   where module = 'deliveries' and owner_mobile = me and data ->> 'orderNumber' = '#' || plan_order
   order by data ->> 'date' desc, created_at desc limit 1;
  if plan.id is null or last_stop.id is null then
    raise exception 'This plan is not yours' using errcode = '42501';
  end if;

  last_day := private.day_before_first_delivery(plan)
              + coalesce((plan.subscription ->> 'days')::integer, 0) + coalesce((plan.subscription ->> 'pausedDays')::integer, 0)
              + coalesce((select sum((e.subscription ->> 'days')::integer)::integer from public.orders e
                           where e.subscription ->> 'extendsOrderId' = plan_order and e.status <> 'cancelled'
                             and e.payment_status in ('paid', 'not_charged')), 0);
  if today <= private.day_before_first_delivery(plan) or today > last_day then
    raise exception 'Today is not a delivery day of this plan';
  end if;
  if exists (select 1 from public.panel_records p
              where p.module = 'pause-requests' and p.data ->> 'status' = 'Approved'
                and plan_order in (p.data ->> 'websiteOrderId', p.data ->> 'planOrderId')
                and today >= ((p.data ->> 'pauseFrom')::timestamptz at time zone 'Asia/Kolkata')::date
                and today < ((p.data ->> 'resumeOn')::timestamptz at time zone 'Asia/Kolkata')::date) then
    raise exception 'Today is skipped or paused for this customer';
  end if;
  if coalesce(plan.subscription -> 'deliveredDays', '[]'::jsonb) ? today_key then
    return;
  end if;

  update public.orders
     set subscription = subscription || jsonb_build_object(
           'deliveredDays', coalesce(subscription -> 'deliveredDays', '[]'::jsonb) || to_jsonb(today_key))
   where id = plan.id;

  select id into today_stop from public.panel_records
   where module = 'deliveries' and data ->> 'orderNumber' = '#' || plan_order and data ->> 'date' = today_key
   order by created_at desc limit 1;
  if today_stop is not null then
    update public.panel_records
       set data = data || jsonb_build_object('status', 'Delivered', 'deliveredAt', to_jsonb(now()))
     where module = 'deliveries' and id = today_stop;
  else
    insert into public.panel_records (module, id, data, owner_mobile)
    values ('deliveries', 'D-' || replace(today_key, '-', '') || '-' || plan_order,
            (last_stop.data - 'history' - 'transferRequest')
              || jsonb_build_object('id', 'D-' || replace(today_key, '-', '') || '-' || plan_order, 'date', today_key,
                                    'status', 'Delivered', 'deliveredAt', to_jsonb(now()), 'isSubscription', true),
            me);
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.my_assigned_plans()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me text := private.current_delivery_agent();
begin
  return coalesce((
    select jsonb_agg(plan order by plan ->> 'customerName')
      from (
        select jsonb_build_object(
          'orderNumber', o.order_number,
          'customerName', o.customer_name,
          'area', coalesce(o.area, ''),
          'milk', coalesce((select i.name from public.order_items i where i.order_id = o.id order by i.position limit 1), ''),
          'bottles', trim(concat_ws(' × ', o.subscription ->> 'bottlesPerDay', coalesce(o.subscription ->> 'bottleLabel', '1 L'))),
          'firstDay', (private.day_before_first_delivery(o) + 1)::text,
          'lastDay', (private.day_before_first_delivery(o)
                      + coalesce((o.subscription ->> 'days')::integer, 0)
                      + coalesce((o.subscription ->> 'pausedDays')::integer, 0)
                      + coalesce((select sum((e.subscription ->> 'days')::integer)::integer from public.orders e
                                   where e.subscription ->> 'extendsOrderId' = o.order_number and e.status <> 'cancelled'
                                     and e.payment_status in ('paid', 'not_charged')), 0))::text,
          'skips', coalesce((
            select jsonb_agg(((p.data ->> 'pauseFrom')::timestamptz at time zone 'Asia/Kolkata')::date::text)
              from public.panel_records p
             where p.module = 'pause-requests' and p.data ->> 'kind' = 'skip'
               and p.data ->> 'planOrderId' = o.order_number and p.data ->> 'status' = 'Approved'), '[]'::jsonb),
          'pauses', coalesce((
            select jsonb_agg(jsonb_build_object(
                     'from', ((p.data ->> 'pauseFrom')::timestamptz at time zone 'Asia/Kolkata')::date::text,
                     'to', ((p.data ->> 'resumeOn')::timestamptz at time zone 'Asia/Kolkata')::date::text))
              from public.panel_records p
             where p.module = 'pause-requests' and p.data ->> 'websiteOrderId' = o.order_number and p.data ->> 'status' = 'Approved'), '[]'::jsonb),
          'stops', coalesce((
            select jsonb_object_agg(d.data ->> 'date', d.data ->> 'status')
              from public.panel_records d
             where d.module = 'deliveries' and d.data ->> 'orderNumber' = '#' || o.order_number), '{}'::jsonb),
          'slot', coalesce((
            select d.data ->> 'slot' from public.panel_records d
             where d.module = 'deliveries' and d.data ->> 'orderNumber' = '#' || o.order_number
             order by d.data ->> 'date' desc limit 1), '')
        ) as plan
          from public.orders o
         where o.subscription is not null and o.status <> 'cancelled'
           and exists (select 1 from public.panel_records d
                        where d.module = 'deliveries' and d.owner_mobile = me and d.data ->> 'orderNumber' = '#' || o.order_number)
      ) as plans), '[]'::jsonb);
end;
$function$;


-- 3. A stop is dated its delivery morning -------------------------------------------------------------
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


-- 4. Today's stops ------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_todays_plan_stops()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  today_key text := to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD');
  plan public.orders;
  last_stop public.panel_records;
  new_id text;
  added integer := 0;
  moved integer := 0;
begin
  if not coalesce((select public.current_staff_role()) = 'delivery-agent' or (select public.has_permission('deliveries', 'view')), false) then
    raise exception 'You can''t see the deliveries' using errcode = '42501';
  end if;

  -- One-time stops not finished on an earlier day come along to today (an order with a stop today keeps that one)
  update public.panel_records d
     set data = d.data || jsonb_build_object('date', today_key)
   where d.module = 'deliveries' and d.data ->> 'orderNumber' is not null
     and not coalesce((d.data ->> 'isSubscription')::boolean, false)
     and d.data ->> 'status' in ('Pending', 'Out for delivery')
     and d.data ->> 'date' < today_key
     and not exists (select 1 from public.panel_records t
                      where t.module = 'deliveries' and t.data ->> 'orderNumber' = d.data ->> 'orderNumber' and t.data ->> 'date' = today_key);
  get diagnostics moved = row_count;
  added := moved;

  for plan in
    select * from public.orders o
     where o.subscription is not null and o.status <> 'cancelled' and not (o.subscription ? 'extendsOrderId')
  loop
    -- The plan's agent: the one on its last stop. No stop yet: no agent has been given
    select * into last_stop from public.panel_records d
     where d.module = 'deliveries' and d.owner_mobile is not null and d.data ->> 'orderNumber' = '#' || plan.order_number
     order by d.data ->> 'date' desc, d.created_at desc
     limit 1;
    continue when last_stop.id is null;

    update public.panel_records
       set data = data || '{"status": "Missed"}'::jsonb
     where module = 'deliveries' and data ->> 'orderNumber' = '#' || plan.order_number
       and data ->> 'date' < today_key and data ->> 'status' in ('Pending', 'Out for delivery')
       and data ->> 'date' > to_char(private.day_before_first_delivery(plan), 'YYYY-MM-DD');

    continue when today <= private.day_before_first_delivery(plan) or today > private.plan_last_day(plan);
    continue when exists (
      select 1 from public.panel_records p
       where p.module = 'pause-requests' and p.data ->> 'status' = 'Approved' and p.data ->> 'websiteOrderId' = plan.order_number
         and today >= ((p.data ->> 'pauseFrom')::timestamptz at time zone 'Asia/Kolkata')::date
         and today < ((p.data ->> 'resumeOn')::timestamptz at time zone 'Asia/Kolkata')::date);
    -- The stop made the day it was paid is this plan's first morning, not a day gone by
    update public.panel_records
       set data = data || jsonb_build_object('date', today_key)
     where module = 'deliveries' and data ->> 'orderNumber' = '#' || plan.order_number
       and data ->> 'date' <= to_char(private.day_before_first_delivery(plan), 'YYYY-MM-DD') and data ->> 'status' in ('Pending', 'Out for delivery');
    continue when exists (
      select 1 from public.panel_records d
       where d.module = 'deliveries' and d.data ->> 'orderNumber' = '#' || plan.order_number and d.data ->> 'date' = today_key);

    new_id := 'D-' || replace(today_key, '-', '') || '-' || plan.order_number;
    insert into public.panel_records (module, id, data, owner_mobile)
    values ('deliveries', new_id,
            (last_stop.data - 'history' - 'transferRequest' - 'deliveredAt' - 'proof')
              || jsonb_build_object('id', new_id, 'date', today_key, 'status', 'Pending', 'isSubscription', true,
                                    'items', private.one_day_items(last_stop.data -> 'items', plan.subscription)),
            last_stop.owner_mobile)
    on conflict do nothing;
    if found then
      added := added + 1;
    end if;
  end loop;
  -- Each morning: the plans' share of stock follows who is delivered today (new plans in, paused plans out)
  perform private.refresh_all_plan_shares();
  return added;
end;
$function$;
