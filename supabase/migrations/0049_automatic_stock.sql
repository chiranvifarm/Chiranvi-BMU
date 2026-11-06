-- Automatic stock: counted in bottles and packets, the plans' share first.
--   Staff enter how many of each pack they have (Products & pricing -> Stock details), in the counts 0029 keeps:
--     40 bottles of 1 litre, 10 bottles of 500 ml, 100 packets of 250 g. A pack's off switch stays its count at 0.
--   Plans first: "forPlans" inside product_cards.stock_counts is how many of each pack today's running plans take
--     ({"forPlans": {"a2-desi-milk": 10}}; paused plans left out, a plan bought today counts from tomorrow).
--     The rest is for one-time orders: 40 bottles, plans 10, 30 for one-time.
--   The label is automatic from what is left for one-time: Low at 5 or less of a pack, Out when every pack is at 0.
--   Milk can now be Out, for one-time orders only: new plans are still sold, and running plans carry on.
--   Pay now holds, a paid order lowers the count, a cancelled or refunded one puts it back: as 0029 did.
--   Staff enter the count again when they restock: plans' daily bottles do not lower the count by themselves.
--   No table changes. A pack without a number works as before.
-- Safe to run again.

-- 1. How many of each pack today's running plans take ----------------------------------------------------------------
create or replace function private.plan_share_today(p_card_id text)
returns jsonb
language plpgsql stable
set search_path to 'public'
as $$
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
    continue when today <= (plan.placed_at at time zone 'Asia/Kolkata')::date or today > private.plan_last_day(plan);
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
$$;

-- 2. Keeping the plans' share up to date on counted products (the label follows, by its trigger) ------------------------
create or replace function private.refresh_plan_share(p_card_id text)
returns void
language plpgsql
set search_path to 'public'
as $$
declare
  share jsonb := private.plan_share_today(p_card_id);
begin
  update public.product_cards c
     set stock_counts = case when share = '{}'::jsonb or (c.stock_counts - 'forPlans') = '{}'::jsonb then c.stock_counts - 'forPlans'
                             else c.stock_counts || jsonb_build_object('forPlans', share) end
   where c.product_id = p_card_id and c.stock_counts <> '{}'::jsonb
     and c.stock_counts is distinct from
         case when share = '{}'::jsonb or (c.stock_counts - 'forPlans') = '{}'::jsonb then c.stock_counts - 'forPlans'
              else c.stock_counts || jsonb_build_object('forPlans', share) end;
end;
$$;

create or replace function private.refresh_all_plan_shares()
returns void
language plpgsql
set search_path to 'public'
as $$
declare
  card_id text;
begin
  for card_id in select c.product_id from public.product_cards c where c.stock_counts <> '{}'::jsonb loop
    perform private.refresh_plan_share(card_id);
  end loop;
end;
$$;

-- 3. Out only because no bottles are left for one-time orders (switched off in the panel is a real stop) ---------------
create or replace function private.is_out_by_stock_only(p_product_id text)
returns boolean
language sql stable
set search_path to 'public'
as $$
  select coalesce((select c.is_visible and (c.stock_counts - 'forPlans') <> '{}'::jsonb
                     from public.product_cards c where c.product_id = private.stock_card_of(p_product_id)), false);
$$;

-- 4. The label, the hold at Pay now and saving the counts: the ones the database had, with the plans' share added --------
CREATE OR REPLACE FUNCTION private.stock_label(p_card_id text, p_counts jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  keys text[] := private.stock_keys_of(p_card_id);
  is_milk boolean := exists (
    select 1 from public.product_pages p
    where not p.is_hidden and p.page ->> 'kind' = 'subscription'
      and (p.slug = p_card_id or coalesce(p.page -> 'panelCardIds', '[]'::jsonb) ? p_card_id));
  every_size_is_out boolean;
  one_is_low boolean;
  for_plans jsonb := coalesce(p_counts -> 'forPlans', '{}'::jsonb);
begin
  every_size_is_out := not exists (
    select 1 from unnest(keys) as stock_key
    where coalesce((p_counts ->> stock_key)::integer - coalesce((for_plans ->> stock_key)::integer, 0), 1) > 0);
  -- A size at 0 is turned off or sold out, not low
  one_is_low := exists (
    select 1 from unnest(keys) as stock_key
    where (p_counts ->> stock_key)::integer - coalesce((for_plans ->> stock_key)::integer, 0) between 1 and 5);
  -- Milk can be Out too: it stops one-time orders only, new plans are still sold (private.plan_price)
  if every_size_is_out and (not is_milk or exists (select 1 from unnest(keys) as stock_key where p_counts ? stock_key)) then
    return 'out';
  end if;
  return case when one_is_low then 'low' else 'in' end;
end;
$function$;

CREATE OR REPLACE FUNCTION private.hold_checkout_stock(p_checkout_id uuid, p_mobile text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  line record;
  in_stock integer;
  held integer;
  free integer;
begin
  -- Cards in one order, so two checkouts never wait for each other
  for line in
    select wanted.order_id, wanted.card_id, wanted.stock_key, wanted.quantity, wanted.product_name
    from (
      select i.order_id, private.stock_card_of(i.product_id) as card_id, i.product_id as stock_key,
             sum(i.quantity)::integer as quantity, trim(min(i.name) || ' ' || min(i.pack_size)) as product_name
      from public.order_items i
      join public.orders o on o.id = i.order_id
      where o.checkout_id = p_checkout_id and o.subscription is null
      group by i.order_id, i.product_id
    ) wanted
    join public.product_cards c on c.product_id = wanted.card_id
    where c.stock_counts ? wanted.stock_key
    order by wanted.card_id, wanted.stock_key
    for update of c
  loop
    select (c.stock_counts ->> line.stock_key)::integer into in_stock from public.product_cards c where c.product_id = line.card_id;
    -- Held by other customers' payments still going on
    select coalesce(sum((held_line.value ->> 'quantity')::integer), 0) into held
    from public.orders o
    cross join lateral jsonb_array_elements(o.stock_lines) as held_line
    where o.payment_status = 'awaiting_payment' and o.stock_lines is not null
      and o.placed_at > now() - interval '30 minutes' and o.customer_mobile <> p_mobile
      and held_line.value ->> 'cardId' = line.card_id and held_line.value ->> 'stockKey' = line.stock_key;
    -- Plans come first: today's plans' bottles are not for sale
    free := greatest(in_stock - held - coalesce((select (c.stock_counts -> 'forPlans' ->> line.stock_key)::integer
                                                   from public.product_cards c where c.product_id = line.card_id), 0), 0);
    if free = 0 then
      raise exception '% is sold out right now. Remove it from your cart.', line.product_name using errcode = 'P0001', hint = 'unavailable';
    end if;
    if line.quantity > free then
      raise exception 'Only % left of %. Lower the quantity in your cart.', free, line.product_name using errcode = 'P0001', hint = 'unavailable';
    end if;
    update public.orders
       set stock_lines = coalesce(stock_lines, '[]'::jsonb)
                         || jsonb_build_array(jsonb_build_object('cardId', line.card_id, 'stockKey', line.stock_key, 'quantity', line.quantity))
     where id = line.order_id;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_stock_counts(p_product_id text, p_counts jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  keys text[];
  merged jsonb;
  entry record;
begin
  if not (select public.has_permission('products', 'edit')) then
    raise exception 'You can''t change stock' using errcode = '42501';
  end if;
  if jsonb_typeof(p_counts) is distinct from 'object' then
    raise exception 'The stock counts could not be read';
  end if;
  select c.stock_counts into merged from public.product_cards c where c.product_id = p_product_id for update;
  if not found then
    raise exception 'This product wasn''t found';
  end if;
  keys := private.stock_keys_of(p_product_id);
  for entry in select key, value from jsonb_each(p_counts) loop
    if not (entry.key = any (keys)) then
      raise exception 'That pack size isn''t on this product';
    end if;
    if jsonb_typeof(entry.value) = 'null' then
      merged := merged - entry.key;
    elsif jsonb_typeof(entry.value) <> 'number' or (entry.value #>> '{}')::numeric < 0
          or (entry.value #>> '{}')::numeric > 1000000
          or (entry.value #>> '{}')::numeric <> trunc((entry.value #>> '{}')::numeric) then
      raise exception 'Stock must be a whole number, 0 or more';
    else
      merged := merged || jsonb_build_object(entry.key, entry.value);
    end if;
  end loop;
  update public.product_cards set stock_counts = merged where product_id = p_product_id;
  perform private.refresh_plan_share(p_product_id);
  return merged;
end;
$function$;

-- 5. New plans are not stopped when milk is out for one-time orders -----------------------------------------------------
CREATE OR REPLACE FUNCTION private.plan_price(p_product_id text, p_plan_id text, p_months integer, p_days integer, p_bottles_per_day integer)
 RETURNS TABLE(unit_paise integer, original_paise integer, price_per_bottle_paise integer, bottle_count integer, plan_total_paise integer, plan jsonb, page_slug text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  line record;
  chosen_plan jsonb;
begin
  select * into line from private.cart_line(p_product_id);
  if line.unit_paise is null or line.page_kind is distinct from 'subscription' then
    raise exception 'This milk plan is no longer available' using errcode = 'P0001', hint = 'unavailable';
  end if;
  -- Out only for one-time orders (no bottles left after the plans' share): new plans are still sold
  if not line.is_available and not private.is_out_by_stock_only(p_product_id) then
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
$function$;

-- 6. The daily plan stops: the one from 0047, which now also refreshes the plans' share ---------------------------------
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
begin
  if not coalesce((select public.current_staff_role()) = 'delivery-agent' or (select public.has_permission('deliveries', 'view')), false) then
    raise exception 'You can''t see the deliveries' using errcode = '42501';
  end if;

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
       and data ->> 'date' < today_key and data ->> 'status' in ('Pending', 'Out for delivery');

    continue when today <= (plan.placed_at at time zone 'Asia/Kolkata')::date or today > private.plan_last_day(plan);
    continue when exists (
      select 1 from public.panel_records p
       where p.module = 'pause-requests' and p.data ->> 'status' = 'Approved' and p.data ->> 'websiteOrderId' = plan.order_number
         and today >= ((p.data ->> 'pauseFrom')::timestamptz at time zone 'Asia/Kolkata')::date
         and today < ((p.data ->> 'resumeOn')::timestamptz at time zone 'Asia/Kolkata')::date);
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

-- 7. Clearing every number: the product stops being counted, so the label goes back to In stock (no buttons to set it now)
create or replace function public.stock_label_follows_counts()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $function$
begin
  if new.stock_counts = '{}'::jsonb then
    if tg_op = 'UPDATE' and old.stock_counts <> '{}'::jsonb then
      new.stock := 'in';
      new.out_of_stock_reported_by := null;
      new.out_of_stock_reported_at := null;
    end if;
    return new;
  end if;
  new.stock := private.stock_label(new.product_id, new.stock_counts);
  if new.stock = 'out' and (tg_op = 'INSERT' or old.stock <> 'out') then
    new.out_of_stock_reported_by := 'Stock count';
    new.out_of_stock_reported_at := now();
  elsif new.stock <> 'out' then
    new.out_of_stock_reported_by := null;
    new.out_of_stock_reported_at := null;
  end if;
  return new;
end;
$function$;
