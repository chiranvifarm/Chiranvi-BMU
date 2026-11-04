-- =====================================================================================================
-- 0029 · Real stock counts
--   Stock was only a label (In / Low / Out) set by hand. Now staff can enter how many are in stock, one number
--   per pack size. A pack size without a number works as before: nothing changes until a number is entered.
--   1. product_cards.stock_counts: {"jersey-ghee-1-litre": 12, "jersey-ghee-250-ml": 40}: by the id the cart uses.
--      Staff set them with set_stock_counts() (Products & pricing → Products Edit), nobody writes them directly.
--   2. Once a product has counts the label follows them: Out when every pack size is at 0, Low when one is at 5
--      or less, else In. A milk page is never marked Out by its count: milk plans don't use the count, and Out
--      would stop them being sold.
--   3. Pay now holds what is in the cart for 30 minutes (hold_checkout_stock, called by start_checkout): the
--      count doesn't change yet, but other customers can't buy what is held. Not enough left: nothing is
--      saved and the cart says so. A payment left unfinished frees its hold by itself after 30 minutes, so no
--      timer job is needed. A customer's own earlier try doesn't count against them.
--   4. The count goes down when the order is paid, and comes back when it is cancelled, refunded or its
--      payment fails (order_stock_follows, on orders). A paid order is never refused: the money is already
--      taken, so the count stops at 0.
--   Only one-time items count: a milk plan's order never touches stock. Orders typed in on the panel's Orders
--   page are free text with no product, so they don't count either.
--   No new table.
-- Safe to run again.
-- =====================================================================================================


-- 1. The counts ----------------------------------------------------------------------------------------
alter table public.product_cards
  add column if not exists stock_counts jsonb not null default '{}'::jsonb;

alter table public.product_cards drop constraint if exists product_cards_stock_counts_check;
alter table public.product_cards add constraint product_cards_stock_counts_check check (jsonb_typeof(stock_counts) = 'object');

alter table public.orders
  add column if not exists stock_lines jsonb,                            -- what it holds or took: [{cardId, stockKey, quantity}]
  add column if not exists stock_taken boolean not null default false;   -- true: stock_lines has been taken off the counts

create index if not exists orders_stock_holds_idx on public.orders (placed_at)
  where payment_status = 'awaiting_payment' and stock_lines is not null;


-- The ids a card's pack sizes go by in the cart: a pack '<slug>-<packId>', milk '<slug>' and '<slug>-half-litre',
-- a card without a page its own id
create or replace function private.stock_keys_of(p_card_id text)
returns text[]
language plpgsql stable
set search_path = public
as $$
declare
  found_page public.product_pages;
  keys text[];
begin
  select p.* into found_page
  from public.product_pages p
  where not p.is_hidden and (p.slug = p_card_id or coalesce(p.page -> 'panelCardIds', '[]'::jsonb) ? p_card_id)
  order by (p.slug = p_card_id) desc
  limit 1;
  if not found then
    return array[p_card_id];
  end if;
  if found_page.page ->> 'kind' = 'subscription' then
    keys := array[found_page.slug];
    if coalesce((found_page.page ->> 'hasHalfLitreBottle')::boolean, false) then
      keys := keys || (found_page.slug || '-half-litre');
    end if;
    return keys;
  end if;
  select array_agg(found_page.slug || '-' || (pack.value ->> 'packId')) into keys
  from jsonb_array_elements(coalesce(found_page.page -> 'packs', '[]'::jsonb)) as pack;
  return coalesce(keys, array[p_card_id]);
end;
$$;

-- The card that keeps a cart line's stock (the same card cart_line() reads the label from)
create or replace function private.stock_card_of(p_product_id text)
returns text
language plpgsql stable
set search_path = public
as $$
declare
  line record;
  card_id text;
begin
  select l.page_slug, l.page into line from private.cart_line(p_product_id) l limit 1;
  select c.product_id into card_id
  from public.product_cards c
  where c.product_id = p_product_id or c.product_id = line.page_slug
     or c.product_id in (select jsonb_array_elements_text(coalesce(line.page -> 'panelCardIds', '[]'::jsonb)))
  order by (c.product_id = p_product_id) desc, (c.product_id = line.page_slug) desc
  limit 1;
  return card_id;
end;
$$;


-- 2. The label follows the counts ----------------------------------------------------------------------
create or replace function private.stock_label(p_card_id text, p_counts jsonb)
returns text
language plpgsql stable
set search_path = public
as $$
declare
  keys text[] := private.stock_keys_of(p_card_id);
  is_milk boolean := exists (
    select 1 from public.product_pages p
    where not p.is_hidden and p.page ->> 'kind' = 'subscription'
      and (p.slug = p_card_id or coalesce(p.page -> 'panelCardIds', '[]'::jsonb) ? p_card_id));
  every_size_is_out boolean;
  one_is_low boolean;
begin
  every_size_is_out := not exists (
    select 1 from unnest(keys) as stock_key
    where coalesce((p_counts ->> stock_key)::integer, 1) > 0);
  one_is_low := exists (
    select 1 from unnest(keys) as stock_key
    where (p_counts ->> stock_key)::integer <= 5);
  if every_size_is_out and not is_milk then
    return 'out';
  end if;
  return case when one_is_low then 'low' else 'in' end;
end;
$$;

-- Only set_stock_counts() and the order steps below change the counts (they run as the database itself)
create or replace function public.guard_stock_counts()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.stock_counts := '{}'::jsonb;
  elsif new.stock_counts is distinct from old.stock_counts then
    raise exception 'Stock counts are changed on Products & pricing';
  end if;
  return new;
end;
$$;

drop trigger if exists product_cards_guard_stock on public.product_cards;
create trigger product_cards_guard_stock
  before insert or update on public.product_cards
  for each row execute function public.guard_stock_counts();

create or replace function public.stock_label_follows_counts()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.stock_counts = '{}'::jsonb then
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
$$;

drop trigger if exists product_cards_stock_label on public.product_cards;
create trigger product_cards_stock_label
  before insert or update on public.product_cards
  for each row execute function public.stock_label_follows_counts();


-- Staff set the counts: {"<cart id>": 12} sets one, {"<cart id>": null} stops counting it. Only the sizes sent
-- change, so a sale happening meanwhile is not undone for the others.
create or replace function public.set_stock_counts(p_product_id text, p_counts jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
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
  return merged;
end;
$$;

revoke execute on function public.set_stock_counts(text, jsonb) from public, anon;
grant execute on function public.set_stock_counts(text, jsonb) to authenticated;


-- 3. Pay now holds the one-time items -------------------------------------------------------------------
create or replace function private.hold_checkout_stock(p_checkout_id uuid, p_mobile text)
returns void
language plpgsql
set search_path = public
as $$
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
    free := greatest(in_stock - held, 0);
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
$$;

-- 0016's start_checkout(), with the hold added before it answers
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

  -- The one-time items must be in stock; not enough left: nothing is kept
  perform private.hold_checkout_stock(checkout, mobile);

  return jsonb_build_object('checkoutId', checkout, 'amountPaise', total_paise, 'orders', answers);
end;
$$;


-- 4. Paid: the count goes down; cancelled, refunded or failed: it comes back ------------------------------
create or replace function private.change_stock(p_lines jsonb, p_direction integer)
returns void
language plpgsql
set search_path = public
as $$
declare
  line jsonb;
begin
  for line in
    select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) order by value ->> 'cardId', value ->> 'stockKey'
  loop
    -- A pack size no longer counted is left alone
    update public.product_cards c
       set stock_counts = jsonb_set(c.stock_counts, array[line ->> 'stockKey'],
             to_jsonb(greatest((c.stock_counts ->> (line ->> 'stockKey'))::integer + p_direction * (line ->> 'quantity')::integer, 0)))
     where c.product_id = line ->> 'cardId' and c.stock_counts ? (line ->> 'stockKey');
  end loop;
end;
$$;

create or replace function public.order_stock_follows()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.stock_taken and old.status <> 'delivered' then
      perform private.change_stock(old.stock_lines, 1);
    end if;
    return old;
  end if;
  if not new.stock_taken and new.stock_lines is not null and new.payment_status = 'paid' and new.status <> 'cancelled' then
    perform private.change_stock(new.stock_lines, -1);
    new.stock_taken := true;
  elsif new.stock_taken and (new.status = 'cancelled' or new.payment_status in ('failed', 'refunded')) then
    perform private.change_stock(new.stock_lines, 1);
    new.stock_taken := false;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_stock_follows on public.orders;
create trigger orders_stock_follows
  before update of status, payment_status on public.orders
  for each row execute function public.order_stock_follows();

drop trigger if exists orders_stock_follows_delete on public.orders;
create trigger orders_stock_follows_delete
  before delete on public.orders
  for each row execute function public.order_stock_follows();

revoke execute on function public.guard_stock_counts(), public.stock_label_follows_counts(), public.order_stock_follows() from public, anon, authenticated;
revoke execute on function private.stock_keys_of(text), private.stock_card_of(text), private.stock_label(text, jsonb),
  private.hold_checkout_stock(uuid, text), private.change_stock(jsonb, integer) from public, anon, authenticated;
