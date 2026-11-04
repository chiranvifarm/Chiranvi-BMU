-- =====================================================================================================
-- 0029 · A team member's profile, roles from the panel, and asking to change a number or address
--   1. A delivery agent's Profile name reaches their agent card, routes and stops (0022 only reached the
--      staff list). Their open transfers follow too. Past history lines keep the old name.
--   2. give_team_role(): the owner or a manager makes someone on the staff list "Staff" (Staff section) or
--      "Delivery agent" (Routes & agents), shown on Roles & permissions. Nobody becomes a manager or the
--      owner this way, and managers and the owner can't be changed by it.
--   3. A team member asks before changing their number or Profile address (customers change theirs freely):
--      request_number_change() / request_address_change(), kept on their staff row (no new table). Anyone
--      with Staff → Edit, but not the person themselves, answers with decide_staff_request().
--      An accepted address is applied at once. An accepted number waits for the OTP on the new number.
--   4. finish_my_number_change(): after the OTP changed the login's phone, moves everything from the old
--      number to the new one: customer, addresses, orders, restock requests, staff row, panel records.
--      The Customer ID is made from the number, so it changes with it.
--   5. The database refuses a team member changing their own Profile address without a request.
-- Safe to run again.
-- =====================================================================================================


-- 1. The agent's name everywhere ---------------------------------------------------------------------
create or replace function private.sync_agent_card_name(agent_mobile text, new_name text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  old_name text;
  card_name text := coalesce(nullif(trim(new_name), ''), agent_mobile);
begin
  select id into old_name from public.panel_records where module = 'agents' and owner_mobile = agent_mobile limit 1;
  if old_name is null or old_name = card_name then
    return;
  end if;
  -- The name is a card's id: as in 0024, a name already taken gets the number's last 4 digits
  if exists (select 1 from public.panel_records where module = 'agents' and id = card_name) then
    card_name := card_name || ' · ' || right(agent_mobile, 4);
  end if;

  update public.panel_records
     set id = card_name, data = data || jsonb_build_object('id', card_name, 'name', card_name)
   where module = 'agents' and owner_mobile = agent_mobile;
  update public.panel_records
     set data = data || jsonb_build_object('agent', card_name)
   where module in ('routes', 'deliveries') and data ->> 'agent' = old_name;
  update public.panel_records
     set data = jsonb_set(data, '{transferRequest,fromAgent}', to_jsonb(card_name))
   where module = 'deliveries' and data -> 'transferRequest' ->> 'fromMobile' = agent_mobile;
  update public.panel_records
     set data = jsonb_set(data, '{transferRequest,toAgent}', to_jsonb(card_name))
   where module = 'deliveries' and data -> 'transferRequest' ->> 'toMobile' = agent_mobile;
end;
$$;

create or replace function public.staff_name_to_agent_card()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  perform private.sync_agent_card_name(new.mobile_number, new.name);
  return new;
end;
$$;

drop trigger if exists staff_agent_card_name on public.staff_members;
create trigger staff_agent_card_name
  after update of name on public.staff_members
  for each row when (old.name is distinct from new.name)
  execute function public.staff_name_to_agent_card();

-- Cards that already have an old name
select private.sync_agent_card_name(mobile_number, name) from public.staff_members where role_id = 'delivery-agent' and is_active;


-- 2. Making someone Staff or a Delivery agent ------------------------------------------------------------
create or replace function public.give_team_role(staff_mobile text, new_role text, bike text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  old_role text;
begin
  if not ((select public.is_owner()) or (select public.current_staff_role()) = 'manager') then
    raise exception 'Only the owner or a manager can give this role' using errcode = '42501';
  end if;
  if new_role not in ('staff', 'delivery-agent') then
    raise exception 'Only the owner gives that role, on Roles & permissions' using errcode = '42501';
  end if;
  select role_id into old_role from public.staff_members where mobile_number = staff_mobile for update;
  if not found then
    raise exception 'That number is not on the staff list';
  end if;
  if old_role in ('owner', 'manager') then
    raise exception 'Managers and the owner can only be changed by the owner, on Roles & permissions' using errcode = '42501';
  end if;

  update public.staff_members
     set role_id = new_role,
         job = case when new_role = 'delivery-agent' then 'Delivery agent' else job end,
         staff_group = case when new_role = 'delivery-agent' then 'Delivery' else staff_group end
   where mobile_number = staff_mobile;

  -- The agent card was added by 0024's trigger
  if new_role = 'delivery-agent' and nullif(trim(bike), '') is not null then
    update public.panel_records
       set data = data || jsonb_build_object('bike', upper(trim(bike)))
     where module = 'agents' and owner_mobile = staff_mobile;
  end if;
end;
$$;


-- 3. Asking to change a number or address -----------------------------------------------------------------
-- {status: Pending / Accepted / Rejected, newNumber or primaryAddress, location, pincode, reason, requestedAt,
--  decidedBy, decidedAt, rejectReason}
alter table public.staff_members add column if not exists number_change jsonb;
alter table public.staff_members add column if not exists address_change jsonb;

-- The logged-in team member's number (the owner has their own way to change it)
create or replace function private.current_team_member()
returns text
language plpgsql stable security definer
set search_path = public
as $$
declare
  me text := (select public.current_mobile());
begin
  if me is null or not exists (select 1 from public.staff_members where mobile_number = me and role_id is distinct from 'owner') then
    raise exception 'Only team members send these requests' using errcode = '42501';
  end if;
  return me;
end;
$$;

create or replace function public.request_number_change(new_number text, reason text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  me text := private.current_team_member();
begin
  if new_number !~ '^\d{10}$' or new_number = me then
    raise exception 'Enter a new 10-digit number';
  end if;
  if coalesce(trim(reason), '') = '' then
    raise exception 'Write a reason';
  end if;
  if exists (select 1 from public.customers where mobile_number = new_number)
     or exists (select 1 from public.staff_members where mobile_number = new_number) then
    raise exception 'That number already has an account';
  end if;
  update public.staff_members
     set number_change = jsonb_build_object('status', 'Pending', 'newNumber', new_number, 'reason', trim(reason), 'requestedAt', to_jsonb(now()))
   where mobile_number = me;
end;
$$;

create or replace function public.request_address_change(new_address text, new_location text, new_pincode text, reason text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  me text := private.current_team_member();
begin
  if coalesce(trim(new_address), '') = '' or coalesce(trim(new_location), '') = '' or new_pincode !~ '^\d{6}$' then
    raise exception 'Enter the address, location and 6-digit pincode';
  end if;
  if coalesce(trim(reason), '') = '' then
    raise exception 'Write a reason';
  end if;
  update public.staff_members
     set address_change = jsonb_build_object('status', 'Pending', 'primaryAddress', trim(new_address), 'location', trim(new_location),
                                             'pincode', new_pincode, 'reason', trim(reason), 'requestedAt', to_jsonb(now()))
   where mobile_number = me;
end;
$$;

-- Takes back my own request, or clears an answered one
create or replace function public.clear_my_staff_request(kind text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  me text := private.current_team_member();
begin
  if kind = 'number' then
    update public.staff_members set number_change = null where mobile_number = me;
  elsif kind = 'address' then
    update public.staff_members set address_change = null where mobile_number = me;
  else
    raise exception 'Unknown request';
  end if;
end;
$$;

-- Anyone who may edit staff, never for themselves
create or replace function public.decide_staff_request(staff_mobile text, kind text, accept boolean, reject_reason text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  me text := (select public.current_mobile());
  decider text;
  request jsonb;
  answer jsonb;
begin
  if not ((select public.is_owner()) or (select public.has_permission('staff', 'edit'))) then
    raise exception 'You can''t answer these requests' using errcode = '42501';
  end if;
  if staff_mobile = me then
    raise exception 'Someone else on the panel must answer your own request' using errcode = '42501';
  end if;
  select name into decider from public.staff_members where mobile_number = me;
  select case when kind = 'number' then number_change when kind = 'address' then address_change end into request
    from public.staff_members where mobile_number = staff_mobile for update;
  if request is null or request ->> 'status' <> 'Pending' then
    raise exception 'This request has already been answered';
  end if;

  answer := jsonb_build_object('status', case when accept then 'Accepted' else 'Rejected' end, 'decidedBy', decider, 'decidedAt', to_jsonb(now()))
            || case when accept then '{}'::jsonb else jsonb_build_object('rejectReason', coalesce(trim(reject_reason), '')) end;

  if kind = 'number' then
    update public.staff_members set number_change = request || answer where mobile_number = staff_mobile;
    return;
  end if;

  update public.staff_members set address_change = request || answer where mobile_number = staff_mobile;
  if accept then
    update public.customers
       set primary_address = request ->> 'primaryAddress', location = request ->> 'location', pincode = request ->> 'pincode'
     where mobile_number = staff_mobile;
    update public.addresses a
       set house_and_street = request ->> 'primaryAddress', area = request ->> 'location', pincode = request ->> 'pincode'
      from public.customers c
     where c.id = a.customer_id and c.mobile_number = staff_mobile and a.profile_slot = 'primary';
  end if;
end;
$$;


-- 4. The new number everywhere -------------------------------------------------------------------------------
-- The Customer ID of a number, as store/admin-customers-store.ts makes it: the number in base 36
create or replace function private.customer_code_for(mobile text)
returns text
language plpgsql immutable
as $$
declare
  left_over bigint := mobile::bigint;
  digits text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  code text := '';
begin
  while left_over > 0 loop
    code := substr(digits, (left_over % 36)::integer + 1, 1) || code;
    left_over := left_over / 36;
  end loop;
  return 'CUS-' || code;
end;
$$;

create or replace function public.finish_my_number_change()
returns text
language plpgsql security definer
set search_path = public, auth
as $$
declare
  new_number text;
  old_number text;
  old_code text;
  new_code text;
  staff_role text;
  is_on_team boolean;
  request jsonb;
begin
  -- The number the OTP proved, from the login itself
  select right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) into new_number from auth.users where id = auth.uid();
  select mobile_number, customer_code into old_number, old_code from public.customers where user_id = auth.uid();
  if new_number is null or new_number !~ '^\d{10}$' or old_number is null then
    raise exception 'No account to move';
  end if;
  if new_number = old_number then
    return 'same';
  end if;

  select role_id, number_change, true into staff_role, request, is_on_team from public.staff_members where mobile_number = old_number;
  if staff_role = 'owner' then
    raise exception 'The owner''s number changes only through "Change number" with the password' using errcode = '42501';
  end if;
  if coalesce(is_on_team, false) and (request ->> 'status' is distinct from 'Accepted' or request ->> 'newNumber' is distinct from new_number) then
    raise exception 'Your new number has to be accepted on the panel first' using errcode = '42501';
  end if;
  if exists (select 1 from public.customers where mobile_number = new_number)
     or exists (select 1 from public.staff_members where mobile_number = new_number) then
    raise exception 'That number already has an account';
  end if;

  new_code := private.customer_code_for(new_number);
  -- The panel's record first: saving the customer below writes to the record with the new Customer ID
  update public.panel_records
     set id = new_code, data = data || jsonb_build_object('id', new_code)
   where module = 'customers' and id = old_code and not is_sample;
  update public.customers
     set mobile_number = new_number, customer_code = new_code,
         secondary_mobile = nullif(secondary_mobile, new_number)
   where user_id = auth.uid();
  update public.addresses a set mobile_number = new_number
    from public.customers c where c.id = a.customer_id and c.user_id = auth.uid() and a.mobile_number = old_number;
  update public.orders set customer_mobile = new_number, customer_code = new_code where customer_mobile = old_number;
  update public.orders set delivery_mobile = new_number where delivery_mobile = old_number;
  update public.restock_requests set mobile_number = new_number where mobile_number = old_number;
  -- (leave_requests follow by their foreign key)
  update public.staff_members set mobile_number = new_number, number_change = null where mobile_number = old_number;

  -- The panel's lists: who a record belongs to, today's agent day, and the number inside each record
  update public.panel_records set owner_mobile = new_number where owner_mobile = old_number;
  update public.panel_records set id = new_number || substr(id, 11) where module = 'agent-days' and id like old_number || ':%';
  update public.panel_records
     set data = replace(data::text, old_number, new_number)::jsonb
   where data::text like '%' || old_number || '%';
  return 'moved';
end;
$$;


-- 5. A team member's own address needs a request ---------------------------------------------------------------
create or replace function public.guard_team_profile_address()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  old_mobile text;
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'customers' then
    old_mobile := old.mobile_number;
    -- Nothing to protect yet: the first address they save
    if coalesce(old.primary_address, '') = '' or (new.primary_address is not distinct from old.primary_address
        and new.location is not distinct from old.location and new.pincode is not distinct from old.pincode) then
      return new;
    end if;
  else
    if old.profile_slot is distinct from 'primary' then
      return coalesce(new, old);
    end if;
    if tg_op = 'UPDATE' and new.house_and_street is not distinct from old.house_and_street
       and new.area is not distinct from old.area and new.pincode is not distinct from old.pincode then
      return new;
    end if;
    select mobile_number into old_mobile from public.customers where id = old.customer_id;
  end if;
  -- Staff editing a customer on the panel are not stopped: only someone changing their own
  if old_mobile = (select public.current_mobile())
     and exists (select 1 from public.staff_members where mobile_number = old_mobile and role_id is distinct from 'owner') then
    raise exception 'Team members send a request to change their address';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists customers_guard_team_address on public.customers;
create trigger customers_guard_team_address
  before update on public.customers
  for each row execute function public.guard_team_profile_address();

drop trigger if exists addresses_guard_team_address on public.addresses;
create trigger addresses_guard_team_address
  before update or delete on public.addresses
  for each row execute function public.guard_team_profile_address();


-- Who may call what
revoke execute on function private.sync_agent_card_name(text, text) from public, anon, authenticated;
revoke execute on function private.current_team_member() from public, anon, authenticated;
revoke execute on function private.customer_code_for(text) from public, anon, authenticated;
revoke execute on function public.staff_name_to_agent_card() from public, anon, authenticated;
revoke execute on function public.give_team_role(text, text, text) from public, anon;
revoke execute on function public.request_number_change(text, text) from public, anon;
revoke execute on function public.request_address_change(text, text, text, text) from public, anon;
revoke execute on function public.clear_my_staff_request(text) from public, anon;
revoke execute on function public.decide_staff_request(text, text, boolean, text) from public, anon;
revoke execute on function public.finish_my_number_change() from public, anon;
grant execute on function public.give_team_role(text, text, text) to authenticated;
grant execute on function public.request_number_change(text, text) to authenticated;
grant execute on function public.request_address_change(text, text, text, text) to authenticated;
grant execute on function public.clear_my_staff_request(text) to authenticated;
grant execute on function public.decide_staff_request(text, text, boolean, text) to authenticated;
grant execute on function public.finish_my_number_change() to authenticated;
