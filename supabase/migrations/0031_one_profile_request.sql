-- =====================================================================================================
-- 0031 · One request for any change to a team member's Profile
--   0029 asked only for the number and the Profile address. Now a team member asks for any change (name,
--   numbers, email, addresses, location, pincode, "More about you") in one request, from "Edit details":
--   - request_profile_change(details, reason): keeps only what changed, each with its old and new value;
--   - decide_profile_change(): anyone with Staff → Edit, never for themselves;
--   - apply_my_profile_change(): after it is accepted they press Save, and the accepted values (from the
--     request, not the browser) are saved everywhere. A new number is then confirmed by the OTP.
--   - clear_my_profile_change(): takes it back, or clears a rejected one.
--   Replaces 0029's number_change / address_change (no requests were in them). Customers and the owner
--   change their details as before. The database refuses a team member's direct change. No new table.
-- Safe to run again.
-- =====================================================================================================

drop function if exists public.request_number_change(text, text);
drop function if exists public.request_address_change(text, text, text, text);
drop function if exists public.clear_my_staff_request(text);
drop function if exists public.decide_staff_request(text, text, boolean, text);
alter table public.staff_members drop column if exists number_change;
alter table public.staff_members drop column if exists address_change;

-- {status: Pending / Accepted / Rejected, changes: {firstName: {from, to}, …, primaryMobile: {from, to}},
--  reason, requestedAt, decidedBy, decidedAt, rejectReason}
alter table public.staff_members add column if not exists profile_change jsonb;


create or replace function public.request_profile_change(details jsonb, reason text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  me text := private.current_team_member();
  person public.customers;
  saved jsonb;
  changes jsonb := '{}'::jsonb;
  field text;
  new_value text;
  new_number text;
begin
  select * into person from public.customers where mobile_number = me;
  if person.id is null then
    raise exception 'Save your Profile first';
  end if;
  if coalesce(trim(reason), '') = '' then
    raise exception 'Write a reason';
  end if;
  if (select profile_change ->> 'status' from public.staff_members where mobile_number = me) in ('Pending', 'Accepted') then
    raise exception 'You already have a request';
  end if;

  saved := jsonb_build_object(
    'firstName', coalesce(person.first_name, ''), 'lastName', coalesce(person.last_name, ''), 'primaryMobile', me,
    'secondaryMobile', coalesce(person.secondary_mobile, ''), 'email', coalesce(person.email, ''),
    'primaryAddress', coalesce(person.primary_address, ''), 'secondaryAddress', coalesce(person.secondary_address, ''),
    'location', coalesce(person.location, ''), 'pincode', coalesce(person.pincode, ''),
    'dateOfBirth', coalesce(person.date_of_birth::text, ''), 'familySize', coalesce(person.family_size, ''),
    'preferredPlanType', coalesce(person.preferred_plan_type, ''));
  for field in select jsonb_object_keys(saved) loop
    new_value := coalesce(trim(details ->> field), saved ->> field);
    if new_value <> saved ->> field then
      changes := changes || jsonb_build_object(field, jsonb_build_object('from', saved ->> field, 'to', new_value));
    end if;
  end loop;
  if changes = '{}'::jsonb then
    raise exception 'Nothing has changed';
  end if;

  if coalesce(trim(details ->> 'firstName'), 'x') = '' or coalesce(trim(details ->> 'lastName'), 'x') = ''
     or coalesce(trim(details ->> 'primaryAddress'), 'x') = '' or coalesce(trim(details ->> 'location'), 'x') = '' then
    raise exception 'Name, primary address and location can''t be empty';
  end if;
  if changes ? 'pincode' and changes #>> '{pincode,to}' !~ '^\d{6}$' then
    raise exception 'Enter a 6-digit pincode';
  end if;
  if changes ? 'email' and changes #>> '{email,to}' !~ '^\S+@\S+\.\S+$' then
    raise exception 'Enter a valid email';
  end if;
  if changes ? 'secondaryMobile' and changes #>> '{secondaryMobile,to}' !~ '^(\d{10})?$' then
    raise exception 'Secondary mobile number: 10 digits, or leave it empty';
  end if;
  if changes ? 'dateOfBirth' and changes #>> '{dateOfBirth,to}' !~ '^(\d{4}-\d{2}-\d{2})?$' then
    raise exception 'Enter a valid date of birth';
  end if;
  new_number := changes #>> '{primaryMobile,to}';
  if new_number is not null then
    if new_number !~ '^\d{10}$' then
      raise exception 'Enter a new 10-digit number';
    end if;
    if exists (select 1 from public.customers where mobile_number = new_number)
       or exists (select 1 from public.staff_members where mobile_number = new_number) then
      raise exception 'That number already has an account';
    end if;
  end if;

  update public.staff_members
     set profile_change = jsonb_build_object('status', 'Pending', 'changes', changes, 'reason', trim(reason), 'requestedAt', to_jsonb(now()))
   where mobile_number = me;
end;
$$;

-- Takes back a waiting request, or clears a rejected one
create or replace function public.clear_my_profile_change()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  me text := private.current_team_member();
begin
  update public.staff_members set profile_change = null where mobile_number = me;
end;
$$;

-- Anyone who may edit staff, never for themselves
create or replace function public.decide_profile_change(staff_mobile text, accept boolean, reject_reason text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  me text := (select public.current_mobile());
  decider text;
  request jsonb;
begin
  if not ((select public.is_owner()) or (select public.has_permission('staff', 'edit'))) then
    raise exception 'You can''t answer these requests' using errcode = '42501';
  end if;
  if staff_mobile = me then
    raise exception 'Someone else on the panel must answer your own request' using errcode = '42501';
  end if;
  select name into decider from public.staff_members where mobile_number = me;
  select profile_change into request from public.staff_members where mobile_number = staff_mobile for update;
  if request is null or request ->> 'status' <> 'Pending' then
    raise exception 'This request has already been answered';
  end if;
  update public.staff_members
     set profile_change = request
           || jsonb_build_object('status', case when accept then 'Accepted' else 'Rejected' end, 'decidedBy', decider, 'decidedAt', to_jsonb(now()))
           || case when accept then '{}'::jsonb else jsonb_build_object('rejectReason', coalesce(trim(reject_reason), '')) end
   where mobile_number = staff_mobile;
end;
$$;

-- Save, after it is accepted: the accepted values go everywhere. Answers 'saved', or 'confirm-number' when a new
-- number still needs its OTP.
create or replace function public.apply_my_profile_change()
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  me text := private.current_team_member();
  request jsonb;
  changes jsonb;
  person public.customers;
  full_name text;
begin
  select profile_change into request from public.staff_members where mobile_number = me for update;
  if request ->> 'status' is distinct from 'Accepted' then
    raise exception 'Your request has to be accepted on the panel first' using errcode = '42501';
  end if;
  changes := request -> 'changes';

  update public.customers
     set first_name = coalesce(changes #>> '{firstName,to}', first_name),
         last_name = coalesce(changes #>> '{lastName,to}', last_name),
         secondary_mobile = case when changes ? 'secondaryMobile' then nullif(changes #>> '{secondaryMobile,to}', '') else secondary_mobile end,
         email = coalesce(changes #>> '{email,to}', email),
         primary_address = coalesce(changes #>> '{primaryAddress,to}', primary_address),
         secondary_address = case when changes ? 'secondaryAddress' then nullif(changes #>> '{secondaryAddress,to}', '') else secondary_address end,
         location = coalesce(changes #>> '{location,to}', location),
         pincode = coalesce(changes #>> '{pincode,to}', pincode),
         date_of_birth = case when changes ? 'dateOfBirth' then nullif(changes #>> '{dateOfBirth,to}', '')::date else date_of_birth end,
         family_size = case when changes ? 'familySize' then nullif(changes #>> '{familySize,to}', '') else family_size end,
         preferred_plan_type = case when changes ? 'preferredPlanType' then nullif(changes #>> '{preferredPlanType,to}', '') else preferred_plan_type end
   where mobile_number = me
  returning * into person;

  -- The address book's Home and Other follow, as saving a Profile does
  full_name := trim(concat_ws(' ', person.first_name, person.last_name));
  update public.addresses
     set name = full_name, area = person.location, pincode = person.pincode,
         house_and_street = case when profile_slot = 'primary' then person.primary_address else coalesce(person.secondary_address, house_and_street) end
   where customer_id = person.id and profile_slot in ('primary', 'secondary');
  if changes ? 'secondaryAddress' then
    if person.secondary_address is null then
      delete from public.addresses where customer_id = person.id and profile_slot = 'secondary';
    elsif not exists (select 1 from public.addresses where customer_id = person.id and profile_slot = 'secondary') then
      insert into public.addresses (customer_id, label, name, mobile_number, house_and_street, area, city, pincode, profile_slot)
      values (person.id, 'Other', full_name, me, person.secondary_address, person.location, 'Bengaluru', person.pincode, 'secondary');
    end if;
  end if;

  if changes ? 'primaryMobile' then
    update public.staff_members
       set profile_change = request || jsonb_build_object('changes', jsonb_build_object('primaryMobile', changes -> 'primaryMobile'))
     where mobile_number = me;
    return 'confirm-number';
  end if;
  update public.staff_members set profile_change = null where mobile_number = me;
  return 'saved';
end;
$$;


-- The number move (0029) now reads the one request
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

  select role_id, profile_change, true into staff_role, request, is_on_team from public.staff_members where mobile_number = old_number;
  if staff_role = 'owner' then
    raise exception 'The owner''s number changes only through "Change number" with the password' using errcode = '42501';
  end if;
  if coalesce(is_on_team, false) and (request ->> 'status' is distinct from 'Accepted' or request #>> '{changes,primaryMobile,to}' is distinct from new_number) then
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
  update public.staff_members set mobile_number = new_number, profile_change = null where mobile_number = old_number;

  -- The panel's lists: who a record belongs to, today's agent day, and the number inside each record
  update public.panel_records set owner_mobile = new_number where owner_mobile = old_number;
  update public.panel_records set id = new_number || substr(id, 11) where module = 'agent-days' and id like old_number || ':%';
  update public.panel_records
     set data = replace(data::text, old_number, new_number)::jsonb
   where data::text like '%' || old_number || '%';
  return 'moved';
end;
$$;


-- A team member's own Profile (every detail) and its Home / Other addresses need a request
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
    -- Nothing to protect yet: the first time they fill in their Profile
    if old.profile_completed_at is null or (
         new.first_name is not distinct from old.first_name and new.last_name is not distinct from old.last_name
         and new.secondary_mobile is not distinct from old.secondary_mobile and new.email is not distinct from old.email
         and new.primary_address is not distinct from old.primary_address and new.secondary_address is not distinct from old.secondary_address
         and new.location is not distinct from old.location and new.pincode is not distinct from old.pincode
         and new.date_of_birth is not distinct from old.date_of_birth and new.family_size is not distinct from old.family_size
         and new.preferred_plan_type is not distinct from old.preferred_plan_type) then
      return new;
    end if;
  else
    if old.profile_slot is null then
      return coalesce(new, old);
    end if;
    if tg_op = 'UPDATE' and new.house_and_street is not distinct from old.house_and_street
       and new.area is not distinct from old.area and new.pincode is not distinct from old.pincode
       and new.name is not distinct from old.name then
      return new;
    end if;
    select mobile_number into old_mobile from public.customers where id = old.customer_id;
  end if;
  -- Staff editing a customer on the panel are not stopped: only someone changing their own
  if old_mobile = (select public.current_mobile())
     and exists (select 1 from public.staff_members where mobile_number = old_mobile and role_id is distinct from 'owner') then
    raise exception 'Team members send a request to change their Profile';
  end if;
  return coalesce(new, old);
end;
$$;


revoke execute on function public.request_profile_change(jsonb, text) from public, anon;
revoke execute on function public.clear_my_profile_change() from public, anon;
revoke execute on function public.decide_profile_change(text, boolean, text) from public, anon;
revoke execute on function public.apply_my_profile_change() from public, anon;
grant execute on function public.request_profile_change(jsonb, text) to authenticated;
grant execute on function public.clear_my_profile_change() to authenticated;
grant execute on function public.decide_profile_change(text, boolean, text) to authenticated;
grant execute on function public.apply_my_profile_change() to authenticated;
