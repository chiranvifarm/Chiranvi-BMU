-- =====================================================================================================
-- 0019 · Nothing kept in the browser (round 1): the customer's own cart and wishlist, and the Chiranvi Panel's
--        Customers, Subscriptions, Pause requests, Leads and Refunds & complaints lists, in the database
--   Before this, these lived in each browser's storage and were copied between browsers through
--   /api/shared-data, so a customer's browser could hold other people's details.
--   1. account_state: one row per login (only that person reads or changes it): the cart, the milk plan
--      waiting in it, its coupon code, the wishlist, and when panel pages were last opened (badges).
--   2. panel_records: the panel's lists, one row per record (the record as the panel uses it, as JSON),
--      by page ("module"). The database's rules follow Roles & permissions: View / Create / Edit / Delete of
--      that page. A customer sees only their own records (their pause requests) and may only ask for a pause
--      for themselves, as Pending, or take back one still Pending.
--      is_sample marks the sample records copied in once (so they can be removed in one go before launch).
--   3. The database fills in what customers used to write from their browser:
--        - a customer who saves their Profile joins the Customers list (updated when they save again; removed
--          when the account is deleted);
--        - a paid order (or one placed before online payments, "not charged") counts on their record, and a
--          new milk plan joins Subscriptions;
--        - an approved pause pauses that website plan on those days.
--   4. submit_lead(): the website's bulk order and "Request delivery" forms (also for visitors), checked and
--      limited (3 per number in 10 minutes); visitors can't read leads.
--   5. seed_panel_records(): copies a page's sample records (or the list a panel browser already had) once.
-- Safe to run again.
-- =====================================================================================================


-- 1. account_state ----------------------------------------------------------------------------------
create table if not exists public.account_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  cart jsonb not null default '[]'::jsonb check (jsonb_typeof(cart) = 'array' and jsonb_array_length(cart) <= 100),
  cart_subscription jsonb check (cart_subscription is null or jsonb_typeof(cart_subscription) = 'object'),
  cart_coupon text check (cart_coupon is null or length(cart_coupon) <= 40),
  wishlist jsonb not null default '[]'::jsonb check (jsonb_typeof(wishlist) = 'array' and jsonb_array_length(wishlist) <= 200),
  panel_seen jsonb not null default '{}'::jsonb check (jsonb_typeof(panel_seen) = 'object'),
  updated_at timestamptz not null default now()
);

drop trigger if exists account_state_set_updated_at on public.account_state;
create trigger account_state_set_updated_at
  before update on public.account_state
  for each row execute function public.set_updated_at();

alter table public.account_state enable row level security;
grant select, insert, update on public.account_state to authenticated;

drop policy if exists "Own account state" on public.account_state;
create policy "Own account state" on public.account_state for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));


-- 2. panel_records ----------------------------------------------------------------------------------
create table if not exists public.panel_records (
  module text not null check (module in (
    'customers', 'subscriptions', 'pause-requests', 'leads', 'refunds',
    -- round 2 (operations), same rules
    'deliveries', 'routes', 'agents', 'staff', 'reports', 'orders', 'agent-days')),
  id text not null check (length(id) between 1 and 80),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  owner_mobile text check (owner_mobile is null or owner_mobile ~ '^\d{10}$'),  -- a customer's / agent's own record
  is_sample boolean not null default false,
  sort_order integer not null default 0,              -- the order inside one batch (samples keep the panel's order)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (module, id)
);

create index if not exists panel_records_module_order_idx on public.panel_records (module, created_at desc, sort_order);
create index if not exists panel_records_owner_idx on public.panel_records (owner_mobile, module) where owner_mobile is not null;
create index if not exists panel_records_website_order_idx on public.panel_records (module, (data ->> 'websiteOrderId')) where data ? 'websiteOrderId';

drop trigger if exists panel_records_set_updated_at on public.panel_records;
create trigger panel_records_set_updated_at
  before update on public.panel_records
  for each row execute function public.set_updated_at();

-- Which Roles & permissions page each list belongs to
create or replace function public.panel_permission_of(module text)
returns text
language sql immutable
set search_path = public
as $$
  select case module
    when 'agent-days' then 'deliveries'
    when 'agents' then 'routes'
    else module
  end;
$$;

-- The lists the logged-in staff member may View / Create / Edit / Delete (asked once per query by the rules)
create or replace function public.my_panel_modules(action text)
returns text[]
language sql stable security definer
set search_path = public
as $$
  select coalesce(array_agg(m), '{}')
  from unnest(array['customers', 'subscriptions', 'pause-requests', 'leads', 'refunds',
                    'deliveries', 'routes', 'agents', 'staff', 'reports', 'orders', 'agent-days']) as m
  where public.has_permission(public.panel_permission_of(m), action);
$$;

alter table public.panel_records enable row level security;
grant select, insert, update, delete on public.panel_records to authenticated;

drop policy if exists "Staff or own read" on public.panel_records;
create policy "Staff or own read" on public.panel_records for select
  using (module = any((select public.my_panel_modules('view'))::text[])
         or (owner_mobile is not null and owner_mobile = (select public.current_mobile())));
drop policy if exists "Staff add or own requests" on public.panel_records;
create policy "Staff add or own requests" on public.panel_records for insert
  with check (module = any((select public.my_panel_modules('create'))::text[])
              or (module = 'pause-requests' and owner_mobile = (select public.current_mobile()))
              or (module = 'agent-days' and owner_mobile = (select public.current_mobile())
                  and (select public.current_staff_role()) = 'delivery-agent'));
drop policy if exists "Staff edit or own day" on public.panel_records;
create policy "Staff edit or own day" on public.panel_records for update
  using (module = any((select public.my_panel_modules('edit'))::text[])
         or (module = 'agent-days' and owner_mobile = (select public.current_mobile())))
  with check (module = any((select public.my_panel_modules('edit'))::text[])
              or (module = 'agent-days' and owner_mobile = (select public.current_mobile())));
drop policy if exists "Staff delete or own pending" on public.panel_records;
create policy "Staff delete or own pending" on public.panel_records for delete
  using (module = any((select public.my_panel_modules('delete'))::text[])
         or (module = 'pause-requests' and owner_mobile = (select public.current_mobile()) and data ->> 'status' = 'Pending'));

-- A customer's own request is always theirs, Pending, and stamped now; the owner of a record never changes
create or replace function public.guard_panel_record()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if tg_op = 'UPDATE' and (new.owner_mobile is distinct from old.owner_mobile or new.module <> old.module or new.id <> old.id) then
    raise exception 'This record can''t be moved';
  end if;
  if tg_op = 'INSERT' and new.module = 'pause-requests' and not (new.module = any(public.my_panel_modules('create'))) then
    new.data := (new.data - 'decidedBy')
      || jsonb_build_object('status', 'Pending', 'requestedAt', to_jsonb(now()), 'customerMobile', new.owner_mobile);
    new.is_sample := false;
  end if;
  if tg_op = 'INSERT' and new.module = 'agent-days' and not (new.module = any(public.my_panel_modules('create'))) then
    new.is_sample := false;
  end if;
  return new;
end;
$$;

drop trigger if exists panel_records_guard on public.panel_records;
create trigger panel_records_guard
  before insert or update on public.panel_records
  for each row execute function public.guard_panel_record();


-- 3a. Customers list: a customer who saved their Profile -------------------------------------------
create or replace function private.customer_panel_record(c public.customers)
returns jsonb
language sql stable
set search_path = public
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', c.customer_code,
    'name', trim(concat_ws(' ', c.first_name, c.last_name)),
    'area', coalesce(c.location, ''),
    'pincode', c.pincode,
    'phone', substr(c.mobile_number, 1, 5) || ' ' || substr(c.mobile_number, 6, 2) || ' ' || substr(c.mobile_number, 8),
    'registeredAt', to_jsonb(c.profile_completed_at),
    'profile', jsonb_build_object(
      'firstName', c.first_name, 'lastName', c.last_name, 'primaryMobile', c.mobile_number,
      'secondaryMobile', coalesce(c.secondary_mobile, ''), 'email', coalesce(c.email, ''),
      'primaryAddress', coalesce(c.primary_address, ''), 'secondaryAddress', coalesce(c.secondary_address, ''),
      'location', coalesce(c.location, ''), 'pincode', coalesce(c.pincode, ''),
      'dateOfBirth', coalesce(c.date_of_birth::text, ''), 'familySize', coalesce(c.family_size, ''),
      'preferredPlanType', coalesce(c.preferred_plan_type, ''))));
$$;

create or replace function public.sync_customer_to_panel()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.panel_records where module = 'customers' and id = old.customer_code and not is_sample;
    return old;
  end if;
  if new.profile_completed_at is null then
    return new;
  end if;
  insert into public.panel_records (module, id, data, owner_mobile)
  values ('customers', new.customer_code,
          jsonb_build_object('plan', 'No orders yet', 'lifetimeValue', 0, 'orderCount', 0, 'lastOrderDaysAgo', 0,
                             'isPaused', false, 'joinedDaysAgo', 0) || private.customer_panel_record(new),
          null)
  on conflict (module, id) do update
    set data = public.panel_records.data || private.customer_panel_record(new);
  return new;
end;
$$;

drop trigger if exists customers_sync_to_panel on public.customers;
create trigger customers_sync_to_panel
  after insert or update or delete on public.customers
  for each row execute function public.sync_customer_to_panel();


-- 3b. A paid order counts on the customer's record; a new milk plan joins Subscriptions -------------
-- A website milk plan as the Subscriptions page shows it (product_id: its milk, e.g. 'jersey-milk-half-litre')
create or replace function private.subscription_panel_record(o public.orders, product_id text)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  plan jsonb := o.subscription;
  bottles numeric := coalesce((o.subscription ->> 'bottlesPerDay')::numeric, 1);
  litres numeric;
begin
  litres := bottles * case when coalesce(plan ->> 'bottleLabel', '1 L') = '500 ml' then 0.5 else 1 end;
  return jsonb_strip_nulls(jsonb_build_object(
    'id', 'SUB-' || o.order_number,
    'customerName', o.customer_name,
    'area', o.area,
    'milkType', case when coalesce(product_id, '') like 'jersey-milk%' then 'Jersey'
                     when coalesce(product_id, '') like 'skimmed-milk%' then 'Skimmed' else 'A2' end,
    'quantity', case when litres < 1 then (litres * 1000)::integer || ' ml' else trim(to_char(litres, 'FM999990.##')) || ' L' end,
    'litresPerDelivery', litres,
    'container', bottles::integer || ' × ' || coalesce(plan ->> 'bottleLabel', '1 L') || ' glass bottle',
    'frequency', 'Daily',
    'planLength', case when coalesce((plan ->> 'months')::integer, 0) >= 12 then '1 year'
                       when coalesce((plan ->> 'months')::integer, 0) >= 6 then '6 months' else '3 months' end,
    'since', to_jsonb(o.placed_at),
    'isPaused', false,
    'websiteOrderId', o.order_number,
    'customerMobile', o.customer_mobile));
end;
$$;

-- Runs at the end of the transaction, once the order's items are saved too.
create or replace function public.sync_order_to_panel()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  counted_now boolean;
  first_item record;
  plan jsonb := new.subscription;
begin
  counted_now := new.payment_status in ('paid', 'not_charged')
    and (tg_op = 'INSERT' or old.payment_status is null or old.payment_status not in ('paid', 'not_charged'));
  if not counted_now then
    return null;
  end if;
  select i.name, i.product_id into first_item from public.order_items i where i.order_id = new.id order by i.position limit 1;

  -- The customer's record (when they are on the Customers list)
  if new.customer_code is not null then
    update public.panel_records
    set data = data || jsonb_build_object(
      'orderCount', coalesce((data ->> 'orderCount')::integer, 0) + 1,
      'lifetimeValue', coalesce((data ->> 'lifetimeValue')::numeric, 0) + new.total_paise / 100.0,
      'lastOrderAt', to_jsonb(new.placed_at),
      'lastOrderDaysAgo', 0,
      'plan', case
        when plan is not null then coalesce(first_item.name, 'Milk') || ' · ' || coalesce(plan ->> 'planName', '')
        when data ->> 'plan' = 'No orders yet' then 'One-time orders'
        else data ->> 'plan' end)
    where module = 'customers' and id = new.customer_code;
  end if;

  -- A new milk plan (not an extension of one)
  if plan is not null and coalesce(plan ->> 'extendsOrderId', '') = '' then
    insert into public.panel_records (module, id, data)
    values ('subscriptions', 'SUB-' || new.order_number, private.subscription_panel_record(new, first_item.product_id))
    on conflict (module, id) do nothing;
  end if;
  return null;
end;
$$;

drop trigger if exists orders_sync_to_panel on public.orders;
create constraint trigger orders_sync_to_panel
  after insert or update of payment_status on public.orders
  deferrable initially deferred
  for each row execute function public.sync_order_to_panel();


-- 3c. An approved pause pauses that website plan on those days (a rejected one takes it off) ---------
create or replace function public.sync_pause_to_subscription()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.module <> 'pause-requests' or coalesce(new.data ->> 'websiteOrderId', '') = ''
     or (old.data ->> 'status') is not distinct from (new.data ->> 'status') then
    return null;
  end if;
  update public.panel_records
  set data = case when new.data ->> 'status' = 'Approved'
                  then data || jsonb_build_object('pauseFrom', new.data -> 'pauseFrom', 'resumeOn', new.data -> 'resumeOn')
                  else data - 'pauseFrom' - 'resumeOn' end
  where module = 'subscriptions' and data ->> 'websiteOrderId' = new.data ->> 'websiteOrderId';
  return null;
end;
$$;

drop trigger if exists panel_records_pause_to_subscription on public.panel_records;
create trigger panel_records_pause_to_subscription
  after update on public.panel_records
  for each row execute function public.sync_pause_to_subscription();


-- 4. submit_lead(): the website's forms ------------------------------------------------------------
create sequence if not exists public.lead_number_seq start 1000;

-- lead: {name, phone, source, note, address, email, bulkOrderItems}. Visitors' leads are always "Website".
create or replace function public.submit_lead(lead jsonb)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  lead_name text := trim(coalesce(lead ->> 'name', ''));
  phone_digits text := regexp_replace(coalesce(lead ->> 'phone', ''), '\D', '', 'g');
  is_staff boolean := public.has_permission('leads', 'create');
  lead_source text := case when public.has_permission('leads', 'create') then coalesce(lead ->> 'source', 'Website') else 'Website' end;
  new_id text;
begin
  if length(lead_name) < 1 or length(lead_name) > 80 then
    raise exception 'Enter your name';
  end if;
  if right(phone_digits, 10) !~ '^\d{10}$' then
    raise exception 'Enter a 10-digit mobile number';
  end if;
  if lead_source not in ('Instagram', 'Website', 'Referral', 'Google', 'Walk-in') then
    raise exception 'Choose where the lead came from';
  end if;
  if length(coalesce(lead ->> 'note', '')) > 500 or length(coalesce(lead ->> 'address', '')) > 300
     or length(coalesce(lead ->> 'email', '')) > 120
     or (jsonb_typeof(lead -> 'bulkOrderItems') = 'array' and jsonb_array_length(lead -> 'bulkOrderItems') > 30) then
    raise exception 'That request is too long';
  end if;
  if not is_staff and (
    select count(*) from public.panel_records
    where module = 'leads' and regexp_replace(data ->> 'phone', '\D', '', 'g') like '%' || right(phone_digits, 10)
      and created_at > now() - interval '10 minutes') >= 3 then
    raise exception 'We already have your request. We''ll call you soon.';
  end if;
  new_id := 'LD-' || nextval('public.lead_number_seq');
  insert into public.panel_records (module, id, data)
  values ('leads', new_id, jsonb_strip_nulls(jsonb_build_object(
    'id', new_id,
    'name', lead_name,
    'phone', trim(lead ->> 'phone'),
    'source', lead_source,
    'stage', 'new',
    'createdAt', to_jsonb(now()),
    'note', nullif(trim(coalesce(lead ->> 'note', '')), ''),
    'address', nullif(trim(coalesce(lead ->> 'address', '')), ''),
    'email', nullif(trim(coalesce(lead ->> 'email', '')), ''),
    'bulkOrderItems', case when jsonb_typeof(lead -> 'bulkOrderItems') = 'array' then lead -> 'bulkOrderItems' end)));
  return new_id;
end;
$$;


-- 5. seed_panel_records(): a page's samples, copied in once ----------------------------------------
create table if not exists public.panel_seeds (
  seed_key text primary key,       -- 'customers', or 'deliveries:2026-11-03' for a day's sample deliveries
  seeded_at timestamptz not null default now()
);
alter table public.panel_seeds enable row level security;   -- no rules: only seed_panel_records() uses it

-- records: [{"id", "data", "isSample", "ownerMobile"}] in the panel's order. Only staff who can View the page;
-- only the first time for this seed_key (true when it copied them).
create or replace function public.seed_panel_records(seed_key text, module text, records jsonb)
returns boolean
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.has_permission(public.panel_permission_of(module), 'view') then
    return false;
  end if;
  if jsonb_typeof(records) is distinct from 'array' or jsonb_array_length(records) > 5000 then
    raise exception 'Too many records';
  end if;
  insert into public.panel_seeds (seed_key) values (seed_panel_records.seed_key) on conflict do nothing;
  if not found then
    return false;
  end if;
  insert into public.panel_records (module, id, data, owner_mobile, is_sample, sort_order)
  select seed_panel_records.module, r.value ->> 'id', r.value -> 'data',
         case when coalesce(r.value ->> 'ownerMobile', '') ~ '^\d{10}$' then r.value ->> 'ownerMobile' end,
         coalesce((r.value ->> 'isSample')::boolean, true), (r.ordinality - 1)::integer
  from jsonb_array_elements(records) with ordinality as r(value, ordinality)
  where coalesce(r.value ->> 'id', '') <> '' and jsonb_typeof(r.value -> 'data') = 'object'
  on conflict do nothing;
  return true;
end;
$$;


-- 6. What's already in the database joins the lists ------------------------------------------------
insert into public.panel_records (module, id, data)
select 'customers', c.customer_code,
       jsonb_build_object('plan', 'No orders yet', 'lifetimeValue', 0, 'orderCount', 0, 'lastOrderDaysAgo', 0,
                          'isPaused', false, 'joinedDaysAgo', 0) || private.customer_panel_record(c)
from public.customers c
where c.profile_completed_at is not null
on conflict do nothing;

-- Their orders so far (paid, or placed before online payments)
update public.panel_records r
set data = r.data || jsonb_build_object(
  'orderCount', counts.order_count,
  'lifetimeValue', counts.total_paise / 100.0,
  'lastOrderAt', to_jsonb(counts.last_order_at),
  'plan', coalesce(counts.last_plan, case when counts.order_count > 0 then 'One-time orders' else 'No orders yet' end))
from (
  select o.customer_code, count(*)::integer as order_count, sum(o.total_paise) as total_paise, max(o.placed_at) as last_order_at,
         (select coalesce(i.name, 'Milk') || ' · ' || (p.subscription ->> 'planName')
          from public.orders p left join public.order_items i on i.order_id = p.id and i.position = 1
          where p.customer_code = o.customer_code and p.subscription is not null and p.payment_status in ('paid', 'not_charged')
          order by p.placed_at desc limit 1) as last_plan
  from public.orders o
  where o.customer_code is not null and o.payment_status in ('paid', 'not_charged')
  group by o.customer_code
) counts
where r.module = 'customers' and r.id = counts.customer_code and not r.is_sample;

-- Milk plans bought on the website so far
insert into public.panel_records (module, id, data)
select 'subscriptions', 'SUB-' || o.order_number,
       private.subscription_panel_record(o, (select i.product_id from public.order_items i where i.order_id = o.id order by i.position limit 1))
from public.orders o
where o.subscription is not null and coalesce(o.subscription ->> 'extendsOrderId', '') = ''
  and o.payment_status in ('paid', 'not_charged') and o.status <> 'cancelled'
on conflict do nothing;


-- Who may call what
revoke execute on function public.submit_lead(jsonb), public.seed_panel_records(text, text, jsonb),
  public.my_panel_modules(text) from public;
grant execute on function public.submit_lead(jsonb) to anon, authenticated;
grant execute on function public.seed_panel_records(text, text, jsonb), public.my_panel_modules(text) to authenticated;
revoke truncate, trigger, references on public.account_state, public.panel_records, public.panel_seeds from anon, authenticated;
