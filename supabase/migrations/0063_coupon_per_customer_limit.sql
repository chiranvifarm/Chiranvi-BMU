-- =====================================================================================================
-- 0063 · Coupons: a per-customer use limit (how many times ONE customer may use a code)
--   Until now a coupon had only a total cap (coupons.usage_limit, across everyone). This adds a separate
--   "uses per customer" limit, set on Coupons & offers → the coupon form.
--   Kept ADDITIVE on purpose, so the shared coupon functions (check_coupon, save_order, start_checkout,
--   place_order) are NOT rewritten and the lead's work is untouched:
--     1. coupons.per_customer_limit  - a new nullable column (null = no per-customer limit).
--     2. A BEFORE INSERT trigger on public.orders enforces it for every order path (one-time, plan,
--        Razorpay checkout): a customer is blocked once their own successful orders with that code reach
--        the limit. Counts only placed orders (payment_status 'paid' or 'not_charged'); awaiting / failed /
--        refunded do not count.
--   The "unlimited total uses needs an end date" rule stays in the form only (a DB constraint would break
--   existing coupons that are both no-limit and no-expiry, e.g. REFER100).
-- Safe to run again.
-- =====================================================================================================


-- 1. The new column ----------------------------------------------------------------------------------------
alter table public.coupons
  add column if not exists per_customer_limit integer
    check (per_customer_limit is null or per_customer_limit >= 1);          -- null: no per-customer limit

comment on column public.coupons.per_customer_limit is
  'How many times one customer may use this code (null = no per-customer limit). Enforced by the trigger below.';


-- 2. Enforcement: block an order when this customer has already used the code up to its per-customer limit --
-- Runs inside the order-saving functions (security definer), so it reads coupons/orders without RLS getting
-- in the way. Only successful orders count, and never the row being inserted.
create or replace function private.enforce_coupon_per_customer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  per_customer integer;
  used_by_customer integer;
begin
  if new.coupon_code is null then
    return new;
  end if;

  select c.per_customer_limit into per_customer
  from public.coupons c
  where c.code = new.coupon_code;

  if per_customer is null then
    return new;                                  -- no per-customer limit on this code
  end if;

  select count(*) into used_by_customer
  from public.orders o
  where o.customer_mobile = new.customer_mobile
    and o.coupon_code = new.coupon_code
    and o.payment_status in ('paid', 'not_charged')
    and o.id is distinct from new.id;

  if used_by_customer >= per_customer then
    raise exception 'You have already used % the most times allowed.', new.coupon_code
      using errcode = 'P0001', hint = 'coupon';
  end if;

  return new;
end;
$$;

drop trigger if exists orders_coupon_per_customer_limit on public.orders;
create trigger orders_coupon_per_customer_limit
  before insert on public.orders
  for each row
  execute function private.enforce_coupon_per_customer();
