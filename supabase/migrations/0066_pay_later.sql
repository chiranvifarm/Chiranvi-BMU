-- =====================================================================================================
-- 0066 · Pay later (a milk plan starts now, the amount is due by the plan's last day)
--   "Start subscription → Pay later" on the cart. The plan is placed and delivered like any order; the
--   customer pays the amount any time before the plan's last day, from Billing & payment.
--   Kept ADDITIVE: reuses private.save_order() and private.auto_assign_order() unchanged.
--     1. orders.payment_status gains 'pay_later'; a new orders.payment_due_by date (the plan's last day).
--     2. start_pay_later(): places the plan (and any items with it) as 'pay_later', placed now, counts the
--        coupon, and auto-assigns to a delivery agent (same as a paid order, so delivery is the same flow).
--     3. pay_later_amount(): the customer's own pending amount for an order (for "Pay now" in Billing).
--     4. Our payment server only: attach_pay_later_razorpay(), mark_pay_later_paid() (pay the pending amount
--        by Razorpay; does not reset the plan's dates or re-count the coupon).
--   An awaiting_payment order is still hidden from everyone; a pay_later order is a real placed order, so the
--   existing "Own or staff read orders" policy already shows it to the customer and to staff. Safe to run again.
-- =====================================================================================================


-- 1. pay_later status + the due date ------------------------------------------------------------------------
alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check
  check (payment_status in ('not_charged', 'awaiting_payment', 'pay_later', 'paid', 'failed', 'refunded'));

alter table public.orders add column if not exists payment_due_by date;   -- pay_later: the plan's last day
comment on column public.orders.payment_due_by is 'Pay-later orders: the plan''s last day, by which the amount must be paid.';


-- 2. start_pay_later(): place the plan now, pay later -------------------------------------------------------
-- details: {planOrder, itemsOrder, shownTotal} like start_checkout. planOrder is required (pay later is for a
-- milk plan). Answers [order_answer(), ...].
create or replace function public.start_pay_later(details jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  mobile text := public.current_mobile();
  checkout uuid := gen_random_uuid();
  plan_answer jsonb;
  items_answer jsonb;
  total_paise integer := 0;
  placed timestamptz := now();
  promised timestamptz := (((now() at time zone 'Asia/Kolkata')::date + 1) + time '07:00') at time zone 'Asia/Kolkata';
  due date;
  o public.orders;
begin
  if auth.uid() is null or coalesce(mobile, '') !~ '^\d{10}$' then
    raise exception 'Log in to place an order';
  end if;
  if jsonb_typeof(details -> 'planOrder') is distinct from 'object' then
    raise exception 'Pay later is only for a subscription';
  end if;
  if coalesce(details -> 'planOrder' -> 'subscription' ->> 'extendsOrderId', '') = '' then
    perform private.check_delivery_address(coalesce(details -> 'planOrder' ->> 'addressId', details -> 'itemsOrder' ->> 'addressId'), true);
  end if;

  -- Priced and saved by the database (awaiting_payment first; converted to pay_later below)
  plan_answer := private.save_order(details -> 'planOrder', checkout);
  total_paise := total_paise + (plan_answer ->> 'totalPaise')::integer;
  if jsonb_typeof(details -> 'itemsOrder') = 'object' then
    items_answer := private.save_order(details -> 'itemsOrder' || jsonb_build_object('planOrderNumber', plan_answer ->> 'orderNumber'), checkout);
    total_paise := total_paise + (items_answer ->> 'totalPaise')::integer;
  end if;

  if details ->> 'shownTotal' is null or abs(round((details ->> 'shownTotal')::numeric * 100) - total_paise) > 50 then
    raise exception 'Prices have changed. Please check your cart and pay again.' using hint = 'prices';
  end if;

  -- The plan's last day = the first delivery day + (plan days - 1)
  due := (promised at time zone 'Asia/Kolkata')::date + greatest(0, (details -> 'planOrder' -> 'subscription' ->> 'days')::int - 1);

  update public.orders
     set payment_status = 'pay_later', placed_at = placed, promised_at = promised, payment_due_by = due,
         status_changed_at = jsonb_build_object('placed', floor(extract(epoch from placed) * 1000)::bigint)
   where checkout_id = checkout and payment_status = 'awaiting_payment';

  -- The plan has started: count the coupon use and give the order to a delivery agent (same as a paid order)
  for o in select * from public.orders where checkout_id = checkout and payment_status = 'pay_later' loop
    if o.coupon_code is not null and exists (select 1 from public.coupons where code = o.coupon_code) then
      update public.coupons set used = used + 1 where code = o.coupon_code;
      insert into public.coupon_redemptions (code, order_id, order_number, customer_name, area, discount_paise, order_value_paise)
      values (o.coupon_code, o.id, o.order_number, o.customer_name, o.area, coalesce(o.coupon_discount_paise, 0),
              o.total_paise - o.delivery_fee_paise - o.platform_fee_paise + coalesce(o.coupon_discount_paise, 0));
    end if;
    perform private.auto_assign_order(o);
  end loop;

  return (select jsonb_agg(private.order_answer(ord) order by ord.subscription is null)
          from public.orders ord where ord.checkout_id = checkout);
end;
$$;


-- 3. pay_later_amount(): the customer's own pending amount for a pay-later order (for "Pay now" in Billing) --
-- Answers {checkoutId, amountPaise, orderNumbers} for the pay_later order group the order_number belongs to.
create or replace function public.pay_later_amount(p_order_number text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  mobile text := public.current_mobile();
  the_checkout uuid;
begin
  if auth.uid() is null then
    raise exception 'Log in to pay';
  end if;
  select checkout_id into the_checkout
  from public.orders
  where order_number = replace(p_order_number, '#', '') and customer_mobile = mobile and payment_status = 'pay_later'
  limit 1;
  if the_checkout is null then
    raise exception 'No pending pay-later amount for this order';
  end if;
  return (select jsonb_build_object(
            'checkoutId', the_checkout,
            'amountPaise', sum(total_paise),
            'orderNumbers', jsonb_agg(order_number))
          from public.orders where checkout_id = the_checkout and payment_status = 'pay_later');
end;
$$;


-- 4. Our payment server only (secret key): attach + mark paid for a pay-later payment ----------------------
create or replace function public.attach_pay_later_razorpay(p_checkout_id uuid, p_razorpay_order_id text)
returns void
language sql security definer
set search_path = public
as $$
  update public.orders set razorpay_order_id = p_razorpay_order_id
  where checkout_id = p_checkout_id and payment_status = 'pay_later';
$$;

-- The pending amount was paid by Razorpay (our server checked the signature): mark the order(s) paid. Keeps
-- the plan's existing dates (it has been running) and does not re-count the coupon (counted when placed).
create or replace function public.mark_pay_later_paid(p_razorpay_order_id text, p_razorpay_payment_id text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  if coalesce(p_razorpay_order_id, '') = '' or not exists (
    select 1 from public.orders where razorpay_order_id = p_razorpay_order_id and payment_status = 'pay_later') then
    raise exception 'No pay-later order for this payment';
  end if;
  update public.orders
     set payment_status = 'paid', razorpay_payment_id = p_razorpay_payment_id, paid_at = now(), payment_due_by = null
   where razorpay_order_id = p_razorpay_order_id and payment_status = 'pay_later';
  return (select jsonb_agg(private.order_answer(o) order by o.subscription is null)
          from public.orders o where o.razorpay_order_id = p_razorpay_order_id);
end;
$$;


-- 5. Who may call what -------------------------------------------------------------------------------------
revoke execute on function public.start_pay_later(jsonb), public.pay_later_amount(text) from public, anon;
grant execute on function public.start_pay_later(jsonb), public.pay_later_amount(text) to authenticated;
revoke execute on function public.attach_pay_later_razorpay(uuid, text), public.mark_pay_later_paid(text, text) from public, anon, authenticated;
grant execute on function public.attach_pay_later_razorpay(uuid, text), public.mark_pay_later_paid(text, text) to service_role;
