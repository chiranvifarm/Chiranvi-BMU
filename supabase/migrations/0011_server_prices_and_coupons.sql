-- =====================================================================================================
-- 0011 · The database decides every price (nothing the browser sends about money is trusted)
--   1. coupons, coupon_redemptions: the Coupons & offers page's coupons, now in the database (they were kept
--      only in the browser, so a discount could be made up there)
--   2. private.cart_line(): the real price of a cart line, from the product pages (the price source), or
--      from Products & pricing for products without a page (powders …)
--   3. private.coupon_discount(): what a coupon takes off, by the same rules as the checkout always used
--   4. price_cart(): today's prices for the lines in a cart (the cart page keeps itself up to date with it)
--      check_coupon(): whether a code works on this cart, and how much it takes off (checkout's coupon box)
--   5. place_order() again: works out each item's price, a milk plan's total, the coupon discount and the
--      delivery fee itself, saves those, records the coupon use, and refuses the order if the browser's
--      total is different ("Prices have changed") — so a price changed in a browser never reaches an order
--   6. Guards: a customer's login number, Customer ID and login can't be changed from a browser; the
--      delivery fee and free-delivery amount change only by the owner (like prices)
-- Money in paise in the tables; place_order() takes and gives rupees, as the website shows them.
-- Safe to run again.
-- =====================================================================================================


-- Helpers the API can't reach (only the functions below use them)
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;


-- 1. Coupons ---------------------------------------------------------------------------------------
create table if not exists public.coupons (
  code text primary key check (code ~ '^[A-Z0-9_-]{2,30}$'),   -- FIRST50 (capitals, never changes)
  description text not null default '',
  kind text not null check (kind in ('flat', 'percent', 'free-days', 'referral')),
  value numeric(10, 2) not null check (value >= 0),            -- ₹ off, % off, free days, or ₹ reward
  min_order numeric(10, 2) check (min_order is null or min_order >= 0),   -- ₹
  applies_to text not null default 'All products',             -- 'All products', 'Milk', 'Milk plans', 'Paneer', 'Ghee & butter', 'Others'
  usage_limit integer check (usage_limit is null or usage_limit >= 0),    -- empty: no limit
  used integer not null default 0 check (used >= 0),
  valid_from date not null default current_date,
  valid_till date,                                             -- empty: no expiry
  is_paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists coupons_set_updated_at on public.coupons;
create trigger coupons_set_updated_at
  before update on public.coupons
  for each row execute function public.set_updated_at();

create table if not exists public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  code text not null references public.coupons (code) on delete cascade on update cascade,
  order_id uuid references public.orders (id) on delete set null,
  order_number text not null,
  customer_name text not null default '',
  area text not null default '',
  discount_paise integer not null check (discount_paise >= 0),
  order_value_paise integer not null check (order_value_paise >= 0),   -- before the discount
  redeemed_at timestamptz not null default now()
);

create index if not exists coupon_redemptions_code_idx on public.coupon_redemptions (code, redeemed_at desc);
create index if not exists coupon_redemptions_order_id_idx on public.coupon_redemptions (order_id);
create index if not exists coupon_redemptions_redeemed_at_idx on public.coupon_redemptions (redeemed_at desc);

alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;

-- Customers never read the coupon list (codes stay private); checkout asks check_coupon() instead
grant select, insert, update, delete on public.coupons to authenticated;
grant select on public.coupon_redemptions to authenticated;

drop policy if exists "Staff read coupons" on public.coupons;
create policy "Staff read coupons" on public.coupons for select
  using ((select public.has_permission('coupons', 'view')));
drop policy if exists "Staff add coupons" on public.coupons;
create policy "Staff add coupons" on public.coupons for insert
  with check ((select public.has_permission('coupons', 'create')));
drop policy if exists "Staff edit coupons" on public.coupons;
create policy "Staff edit coupons" on public.coupons for update
  using ((select public.has_permission('coupons', 'edit'))) with check ((select public.has_permission('coupons', 'edit')));
drop policy if exists "Staff delete coupons" on public.coupons;
create policy "Staff delete coupons" on public.coupons for delete
  using ((select public.has_permission('coupons', 'delete')));

drop policy if exists "Staff read coupon uses" on public.coupon_redemptions;
create policy "Staff read coupon uses" on public.coupon_redemptions for select
  using ((select public.has_permission('coupons', 'view')));

-- The starting coupons (the same as the panel showed before), once
insert into public.coupons (code, description, kind, value, applies_to, usage_limit, used, valid_from, valid_till, is_paused)
select * from (values
  ('FIRST50', '₹50 off the first order', 'flat', 50, 'All products', 200, 86, date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date, false),
  ('SUB50', '₹50 off a 3-month milk plan', 'flat', 50, 'Milk plans', 300, 31, date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date, false),
  ('A2TRY', 'First 3 days of A2 milk free', 'free-days', 3, 'Milk', 50, 21, date_trunc('month', current_date)::date, current_date + 24, false),
  ('REFER100', '₹100 for you and your friend', 'referral', 100, 'All products', null, 12, date '2026-01-01', null, false),
  ('DIWALI10', '10% off ghee and paneer', 'percent', 10, 'Ghee & butter', 150, 64, date_trunc('month', current_date)::date, current_date + 12, false),
  ('MONSOON20', '20% off curd combo', 'percent', 20, 'Others', 120, 120, (date_trunc('month', current_date) - interval '1 month')::date, (date_trunc('month', current_date) - interval '1 day')::date, false)
) as starting (code, description, kind, value, applies_to, usage_limit, used, valid_from, valid_till, is_paused)
where not exists (select 1 from public.coupons);


-- 2. The real price of a cart line ------------------------------------------------------------------
-- product_id as the website's cart uses it:
--   '<slug>' / '<slug>-half-litre'  a milk (subscription) page, 1 litre / 500 ml
--   '<slug>-<packId>'               a pack on a one-time page, e.g. 'jersey-butter-1-kg'
--   '<card id>'                     a product without a page (Products & pricing), e.g. 'turmeric-powder'
-- Only published pages that aren't deleted count. Prices in paise. Nothing found: no row.
create or replace function private.cart_line(p_product_id text)
returns table (
  unit_paise integer,          -- the price of one, as sold now
  original_paise integer,      -- the crossed-out price (the same as unit_paise when there is none)
  category text,               -- the product's category on Products & pricing ('Others' when it has no card)
  is_available boolean,        -- false: switched off or out of stock on Products & pricing
  page_slug text,              -- the product page, if any
  page_kind text,              -- 'subscription' / 'one-time' / null (no page)
  page jsonb                   -- the page itself (milk plans read their plans from it)
)
language plpgsql stable
set search_path = public
as $$
declare
  found_page public.product_pages;
  found_pack jsonb;
  found_slug text;
  found_page_data jsonb;
  found_card public.product_cards;
  base_price numeric;
  base_original numeric;
begin
  -- A milk page: its 1 litre price, or its 500 ml price
  select p.* into found_page
  from public.product_pages p
  where not p.is_hidden and coalesce(p.page ->> 'status', 'published') = 'published'
    and p.page ->> 'kind' = 'subscription'
    and (p.slug = p_product_id
         or (p.slug || '-half-litre' = p_product_id and coalesce((p.page ->> 'hasHalfLitreBottle')::boolean, false)))
  limit 1;
  if found then
    base_price := (found_page.page ->> 'price')::numeric;
    base_original := nullif((found_page.page ->> 'originalPrice')::numeric, 0);
    if found_page.slug <> p_product_id then
      -- 500 ml: the price set in the panel, otherwise half the litre price, rounded up (as the page shows)
      base_price := case when coalesce((found_page.page ->> 'halfLitrePrice')::numeric, 0) > 0
                         then (found_page.page ->> 'halfLitrePrice')::numeric else ceil(base_price / 2) end;
      base_original := ceil(base_original / 2);
    end if;
    unit_paise := round(base_price * 100);
    original_paise := greatest(unit_paise, coalesce(round(base_original * 100), 0));
    page_slug := found_page.slug;
    page_kind := 'subscription';
    page := found_page.page;
  else
    -- A pack on a one-time page
    select p.slug, p.page, pack.value into found_slug, found_page_data, found_pack
    from public.product_pages p
    cross join lateral jsonb_array_elements(coalesce(p.page -> 'packs', '[]'::jsonb)) as pack
    where not p.is_hidden and coalesce(p.page ->> 'status', 'published') = 'published'
      and p.page ->> 'kind' = 'one-time'
      and p.slug || '-' || (pack.value ->> 'packId') = p_product_id
    limit 1;
    if found then
      unit_paise := round((found_pack ->> 'price')::numeric * 100);
      original_paise := greatest(unit_paise, coalesce(round(nullif((found_pack ->> 'originalPrice')::numeric, 0) * 100), 0));
      page_slug := found_slug;
      page_kind := 'one-time';
      page := found_page_data;
    end if;
  end if;

  if page_slug is not null then
    -- The page's card on Products & pricing (same id, or one made with the page): its category and stock
    select c.* into found_card
    from public.product_cards c
    where c.product_id = p_product_id or c.product_id = page_slug
       or c.product_id in (select jsonb_array_elements_text(coalesce(page -> 'panelCardIds', '[]'::jsonb)))
    order by (c.product_id = p_product_id) desc, (c.product_id = page_slug) desc
    limit 1;
    category := coalesce(found_card.category, 'Others');
    is_available := found_card.product_id is null or (found_card.is_visible and found_card.stock <> 'out');
    return next;
    return;
  end if;

  -- No page: a product on Products & pricing (only one without a page of its own)
  select c.* into found_card from public.product_cards c where c.product_id = p_product_id;
  if found and not exists (select 1 from public.product_pages p where p.slug = p_product_id and not p.is_hidden) then
    unit_paise := found_card.price_paise;
    original_paise := greatest(found_card.price_paise, coalesce(found_card.original_price_paise, 0));
    category := found_card.category;
    is_available := found_card.is_visible and found_card.stock <> 'out';
    return next;
  end if;
end;
$$;


-- 3. What a coupon takes off -------------------------------------------------------------------------
-- The same rules as the checkout always had (store/coupons-store.ts):
--   - must be Active: not paused, started, not ended, not used up
--   - one-time items: not "Milk plans" or free days; reach the minimum order; "All products" counts the
--     whole cart, a category only its items; % off rounds to whole rupees; ₹ off at most the items' value
--   - a milk plan: "All products", "Milk" or "Milk plans" codes only; reach the minimum (the plan's total);
--     free days = those days' bottles at the plan's price
-- lines: [{"amountPaise": 12000, "category": "Milk"}, …] for one-time items, or null for a plan.
-- Raises a message the customer can read when the code can't be used. for_update: lock the coupon row
-- (place_order, so two orders can't both take the last use).
create or replace function private.coupon_discount(
  p_code text, p_lines jsonb, p_plan_total_paise integer, p_plan_unit_paise integer, p_bottles_per_day integer,
  for_update boolean default false)
returns table (code text, discount_paise integer)
language plpgsql
set search_path = public
as $$
declare
  coupon public.coupons;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  cart_total integer;
  eligible integer;
  discount integer;
  is_plan boolean := p_lines is null;
begin
  if for_update then
    select * into coupon from public.coupons c where c.code = upper(trim(p_code)) for update;
  else
    select * into coupon from public.coupons c where c.code = upper(trim(p_code));
  end if;
  if not found then
    raise exception 'This code doesn''t exist' using errcode = 'P0001', hint = 'coupon';
  end if;
  if (coupon.valid_till is not null and coupon.valid_till < today) or (coupon.usage_limit is not null and coupon.used >= coupon.usage_limit) then
    raise exception '% has ended', coupon.code using errcode = 'P0001', hint = 'coupon';
  end if;
  if coupon.is_paused then
    raise exception '% can''t be used right now', coupon.code using errcode = 'P0001', hint = 'coupon';
  end if;
  if coupon.valid_from > today then
    raise exception '% starts on %', coupon.code, to_char(coupon.valid_from, 'DD/MM/YYYY') using errcode = 'P0001', hint = 'coupon';
  end if;

  if is_plan then
    if coupon.applies_to not in ('All products', 'Milk', 'Milk plans') then
      raise exception '% is only for %, not milk plans', coupon.code, lower(coupon.applies_to) using errcode = 'P0001', hint = 'coupon';
    end if;
    if coupon.min_order is not null and coupon.min_order > 0 and p_plan_total_paise < round(coupon.min_order * 100) then
      raise exception '% needs an order of at least ₹%', coupon.code, trim(to_char(coupon.min_order, 'FM999999990.##')) using errcode = 'P0001', hint = 'coupon';
    end if;
    if coupon.kind = 'free-days' then
      discount := round(coupon.value) * p_bottles_per_day * p_plan_unit_paise;
    elsif coupon.kind = 'percent' then
      discount := round(p_plan_total_paise / 100.0 * coupon.value / 100) * 100;
    else
      discount := least(round(coupon.value * 100), p_plan_total_paise);
    end if;
    code := coupon.code;
    discount_paise := least(discount, p_plan_total_paise);
    return next;
    return;
  end if;

  if coupon.applies_to = 'Milk plans' or coupon.kind = 'free-days' then
    raise exception '% is for milk subscriptions, not one-time orders', coupon.code using errcode = 'P0001', hint = 'coupon';
  end if;
  select coalesce(sum((line ->> 'amountPaise')::integer), 0) into cart_total from jsonb_array_elements(p_lines) as line;
  if coupon.min_order is not null and coupon.min_order > 0 and cart_total < round(coupon.min_order * 100) then
    raise exception 'Add ₹% more to use % (minimum ₹%)', trim(to_char((round(coupon.min_order * 100) - cart_total) / 100.0, 'FM999999990.##')),
      coupon.code, trim(to_char(coupon.min_order, 'FM999999990.##')) using errcode = 'P0001', hint = 'coupon';
  end if;
  if coupon.applies_to = 'All products' then
    eligible := cart_total;
  else
    select coalesce(sum((line ->> 'amountPaise')::integer), 0) into eligible
    from jsonb_array_elements(p_lines) as line where line ->> 'category' = coupon.applies_to;
  end if;
  if eligible <= 0 then
    raise exception '% is only for %', coupon.code, lower(coupon.applies_to) using errcode = 'P0001', hint = 'coupon';
  end if;
  if coupon.kind = 'percent' then
    discount := round(eligible / 100.0 * coupon.value / 100) * 100;
  else
    discount := least(round(coupon.value * 100), eligible);
  end if;
  code := coupon.code;
  discount_paise := least(discount, cart_total);
  return next;
end;
$$;


-- A milk plan as the database works it out: the page's plan, the price per bottle with the plan's % off
-- (whole rupees, as the page shows), and the plan's total. Raises when it can't be ordered.
create or replace function private.plan_price(p_product_id text, p_plan_id text, p_months integer, p_days integer, p_bottles_per_day integer)
returns table (unit_paise integer, original_paise integer, price_per_bottle_paise integer, bottle_count integer,
               plan_total_paise integer, plan jsonb, page_slug text)
language plpgsql stable
set search_path = public
as $$
declare
  line record;
  chosen_plan jsonb;
begin
  select * into line from private.cart_line(p_product_id);
  if line.unit_paise is null or line.page_kind is distinct from 'subscription' then
    raise exception 'This milk plan is no longer available' using errcode = 'P0001', hint = 'unavailable';
  end if;
  if not line.is_available then
    raise exception 'This milk is sold out right now' using errcode = 'P0001', hint = 'unavailable';
  end if;
  if p_bottles_per_day is null or p_bottles_per_day < 1 or p_bottles_per_day > 10 then
    raise exception 'Choose between 1 and 10 bottles a day' using errcode = 'P0001';
  end if;
  -- The page's plan with this id; otherwise the one with the same length ("Extend Plan" sends its own id)
  select plan_setting.value into chosen_plan
  from jsonb_array_elements(coalesce(line.page -> 'plans', '[]'::jsonb)) as plan_setting
  where plan_setting.value ->> 'planId' = p_plan_id
     or ((plan_setting.value ->> 'months')::integer = p_months and (plan_setting.value ->> 'days')::integer = p_days)
  order by (plan_setting.value ->> 'planId' = p_plan_id) desc nulls last
  limit 1;
  if chosen_plan is null then
    raise exception 'This milk plan is no longer available' using errcode = 'P0001', hint = 'unavailable';
  end if;
  unit_paise := line.unit_paise;
  original_paise := line.original_paise;
  price_per_bottle_paise := round(line.unit_paise / 100.0 * (1 - coalesce((chosen_plan ->> 'percentOff')::numeric, 0) / 100)) * 100;
  bottle_count := (chosen_plan ->> 'days')::integer * p_bottles_per_day;
  plan_total_paise := bottle_count * price_per_bottle_paise;
  plan := chosen_plan;
  page_slug := line.page_slug;
  return next;
end;
$$;


-- 4a. price_cart(): today's prices for the lines in a cart ------------------------------------------
-- items: [{"productId": "jersey-butter-1-kg"}, …] → [{"productId", "price", "originalPrice", "isAvailable",
-- "isFound"}, …] in rupees. Prices are public (the product pages show them), so visitors may ask too.
create or replace function public.price_cart(items jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  answer jsonb := '[]'::jsonb;
  item jsonb;
  line record;
begin
  if jsonb_typeof(items) is distinct from 'array' then
    return answer;
  end if;
  for item in select value from jsonb_array_elements(items) limit 100 loop
    select * into line from private.cart_line(item ->> 'productId');
    answer := answer || jsonb_build_array(jsonb_build_object(
      'productId', item ->> 'productId',
      'isFound', line.unit_paise is not null,
      'isAvailable', coalesce(line.is_available, false),
      'price', line.unit_paise / 100.0,
      'originalPrice', line.original_paise / 100.0));
  end loop;
  return answer;
end;
$$;


-- 4b. check_coupon(): does this code work on this cart? ---------------------------------------------
-- cart: {"items": [{"productId", "quantity"}], "plan": {"productId", "planId", "months", "days", "bottlesPerDay"} | null}
-- The same choice as checkout: with a plan, the code is tried on the plan first, then on the items.
-- Answers {"code", "description", "discount" (₹), "isForPlan"} or {"error"}. Logged-in customers only.
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
begin
  if auth.uid() is null then
    return jsonb_build_object('error', 'Log in to use a coupon');
  end if;
  if coalesce(trim(code), '') = '' then
    return jsonb_build_object('error', 'Enter a coupon code');
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
      select * into result from private.coupon_discount(code, null, plan_line.plan_total_paise, plan_line.price_per_bottle_paise,
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
    select * into result from private.coupon_discount(code, lines, null, null, null);
    return jsonb_build_object('code', result.code, 'discount', result.discount_paise / 100.0, 'isForPlan', false,
      'description', (select c.description from public.coupons c where c.code = result.code));
  exception when sqlstate 'P0001' then
    return jsonb_build_object('error', coalesce(plan_error, sqlerrm));
  end;
end;
$$;


-- 5. place_order(): the database works out the money ------------------------------------------------
-- details (from the website, amounts in rupees as it shows them):
--   items: [{productId, quantity, …the cart line}]; total (what the customer saw: checked, never saved);
--   couponCode; deliverTo; deliveryMobile; area; paymentMethod;
--   subscription: {planId, planName, months, days, bottlesPerDay, extendsOrderId, bottleLabel, unitName} for a plan;
--   planOrderNumber: the plan placed just before in the same checkout (its items then get free delivery)
-- Prices, the plan's total, the coupon discount and the delivery fee are the database's own. If the total
-- it works out isn't the one the customer saw, nothing is saved: "Prices have changed" (hint 'prices').
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
  free_from_paise integer;
  fee_paise integer;
  is_plan boolean := jsonb_typeof(details -> 'subscription') = 'object';
  saved_items jsonb := '[]'::jsonb;       -- [{productId, name, packSize, quantity, pricePaise, item}]
  coupon_lines jsonb := '[]'::jsonb;
  item jsonb;
  line record;
  plan_line record;
  quantity integer;
  items_total_paise integer := 0;
  discount_paise integer := 0;
  coupon_code text;
  delivery_paise integer := 0;
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
  select coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'free_delivery_from_paise'), 50000) into free_from_paise;
  select coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'delivery_fee_paise'), 3000) into fee_paise;

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
      saved_items := saved_items || jsonb_build_array(jsonb_build_object(
        'productId', item ->> 'productId', 'quantity', quantity, 'pricePaise', line.unit_paise,
        'item', item || jsonb_build_object('quantity', quantity, 'price', line.unit_paise / 100.0, 'originalPrice', line.original_paise / 100.0)));
    end loop;
    if coalesce(trim(details ->> 'couponCode'), '') <> '' then
      select c.code, c.discount_paise into coupon_code, discount_paise
      from private.coupon_discount(details ->> 'couponCode', coupon_lines, null, null, null, true) c;
    end if;
    -- Free delivery from the set amount, or when a plan was placed just before (the items come with it)
    if items_total_paise - discount_paise >= free_from_paise or exists (
      select 1 from public.orders o
      where o.order_number = details ->> 'planOrderNumber' and o.customer_mobile = mobile
        and o.subscription is not null and o.placed_at > placed - interval '15 minutes') then
      delivery_paise := 0;
    else
      delivery_paise := fee_paise;
    end if;
  end if;

  total_paise := items_total_paise - discount_paise + delivery_paise;

  -- The customer must have seen this same total (half a rupee either way for rounding)
  if details ->> 'total' is null or abs(round((details ->> 'total')::numeric * 100) - total_paise) > 50 then
    raise exception 'Prices have changed. Please check your cart and pay again.' using hint = 'prices';
  end if;

  insert into public.orders (
    customer_mobile, customer_id, customer_code, customer_name, area, total_paise, delivery_fee_paise,
    coupon_code, coupon_discount_paise, payment_method, deliver_to, delivery_mobile, subscription,
    placed_at, promised_at, status_changed_at)
  values (
    mobile, customer.id, customer.customer_code,
    coalesce(nullif(trim(concat_ws(' ', customer.first_name, customer.last_name)), ''), split_part(details ->> 'deliverTo', ' · ', 1)),
    coalesce(nullif(details ->> 'area', ''), customer.location, ''),
    total_paise, delivery_paise, coupon_code, case when coupon_code is not null then discount_paise end,
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
    'couponCode', coupon_code,
    'couponDiscount', case when coupon_code is not null then discount_paise / 100.0 end,
    'items', (select jsonb_agg(value -> 'item') from jsonb_array_elements(saved_items)),
    'subscription', subscription);
end;
$$;


-- 6. Guards ------------------------------------------------------------------------------------------
-- A customer row's login number, Customer ID, login and first-save date never change from a browser
-- (a login id can only be filled in once, when it was empty)
create or replace function public.guard_customer_row()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if new.mobile_number is distinct from old.mobile_number
     or new.customer_code is distinct from old.customer_code
     or new.created_at is distinct from old.created_at
     or (old.user_id is not null and new.user_id is distinct from old.user_id) then
    raise exception 'The login number and Customer ID can''t be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists customers_guard_row on public.customers;
create trigger customers_guard_row
  before update on public.customers
  for each row execute function public.guard_customer_row();

-- The delivery fee and the free-delivery amount are prices: only the owner changes them
create or replace function public.guard_money_settings()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_owner() or current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if new.key in ('free_delivery_from_paise', 'delivery_fee_paise') and new.value is distinct from old.value then
    raise exception 'Prices are changed only by the owner';
  end if;
  return new;
end;
$$;

drop trigger if exists app_settings_guard_money on public.app_settings;
create trigger app_settings_guard_money
  before update on public.app_settings
  for each row execute function public.guard_money_settings();


-- Who may call what: ordering and coupons need a login; today's prices are public
revoke execute on function public.place_order(jsonb), public.check_coupon(text, jsonb), public.price_cart(jsonb) from public, anon;
grant execute on function public.place_order(jsonb), public.check_coupon(text, jsonb) to authenticated;
grant execute on function public.price_cart(jsonb) to anon, authenticated;
