-- =====================================================================================================
-- 0022 · A team member's Profile name is their name on the staff list
--   Someone on the staff list (staff_members) who saves their Profile (customers) gets the same name on the
--   staff list: the Staff section, Roles & permissions and the Delivery Panel show the name they gave.
--   One way only (Profile → staff list); an empty Profile name changes nothing. Not the owner: the owner's
--   name changes only from the owner's profile on Roles & permissions. People whose Profile is already
--   filled in are matched once now (not the owner).
-- Safe to run again.
-- =====================================================================================================

create or replace function public.sync_profile_name_to_staff()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  full_name text := trim(concat_ws(' ', nullif(trim(new.first_name), ''), nullif(trim(new.last_name), '')));
begin
  if full_name <> '' then
    update public.staff_members
       set name = full_name
     where mobile_number = new.mobile_number and name is distinct from full_name
       and role_id is distinct from 'owner';
  end if;
  return new;
end;
$$;

drop trigger if exists customers_sync_name_to_staff on public.customers;
create trigger customers_sync_name_to_staff
  after insert or update of first_name, last_name on public.customers
  for each row execute function public.sync_profile_name_to_staff();

-- Profiles already filled in: the same name on the staff list now
update public.staff_members s
   set name = trim(concat_ws(' ', nullif(trim(c.first_name), ''), nullif(trim(c.last_name), '')))
  from public.customers c
 where c.mobile_number = s.mobile_number
   and trim(concat_ws(' ', nullif(trim(c.first_name), ''), nullif(trim(c.last_name), ''))) <> ''
   and s.role_id is distinct from 'owner'
   and s.name is distinct from trim(concat_ws(' ', nullif(trim(c.first_name), ''), nullif(trim(c.last_name), '')));

revoke execute on function public.sync_profile_name_to_staff() from public, anon, authenticated;
