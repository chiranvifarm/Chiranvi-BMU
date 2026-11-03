-- =====================================================================================================
-- 0021 · One staff table: the Staff section creates people, Roles & permissions gives them a role
--   staff_members becomes the farm's whole staff list (no new table): the Chiranvi Panel's Staff section
--   (job, group, shift, salary, today's attendance, days absent this month) was kept only in the browser.
--   1. role_id may be empty: someone on the staff list without a login role (a farm worker, or an agent
--      before they get the delivery app). Roles & permissions gives a role to someone already on the list.
--   2. The Staff section's details as columns. The team already in the table gets a job and group from
--      their role.
--   3. Who may do what:
--        add        the owner (any role), or Staff → Create (without a role)
--        edit       the owner, or Staff → Edit; only the owner changes a role or a salary (guard below)
--        remove     the owner (anyone but the owner); a manager anyone but the owner and managers;
--                   Staff → Delete someone without a role
--   4. start_staff_day(): a new day: yesterday's absence is counted (a new month starts from zero), and
--      everyone not on leave starts as present. The Staff section runs it when it opens.
-- Safe to run again.
-- =====================================================================================================


-- 1-2. Columns ----------------------------------------------------------------------------------------------
alter table public.staff_members alter column role_id drop not null;
alter table public.staff_members add column if not exists job text not null default '';
alter table public.staff_members add column if not exists staff_group text not null default 'Farm';
alter table public.staff_members drop constraint if exists staff_members_staff_group_check;
alter table public.staff_members add constraint staff_members_staff_group_check check (staff_group in ('Delivery', 'Farm', 'Managers'));
alter table public.staff_members add column if not exists shift text not null default '';
alter table public.staff_members add column if not exists salary_paise integer not null default 0 check (salary_paise >= 0);
alter table public.staff_members add column if not exists today_status text not null default 'Present';
alter table public.staff_members drop constraint if exists staff_members_today_status_check;
alter table public.staff_members add constraint staff_members_today_status_check check (today_status in ('Present', 'Absent', 'On leave'));
alter table public.staff_members add column if not exists attendance_date date not null default ((now() at time zone 'Asia/Kolkata')::date);
alter table public.staff_members add column if not exists days_absent_this_month integer not null default 0 check (days_absent_this_month >= 0);

-- The team already here: a job and group from their role
update public.staff_members
   set job = case role_id when 'owner' then 'Owner' when 'manager' then 'Manager' when 'delivery-agent' then 'Delivery agent' else 'Farm worker' end,
       staff_group = case role_id when 'owner' then 'Managers' when 'manager' then 'Managers' when 'delivery-agent' then 'Delivery' else 'Farm' end
 where job = '';


-- 3. Who may do what ----------------------------------------------------------------------------------------------
drop policy if exists "Owner adds staff" on public.staff_members;
drop policy if exists "Owner or staff add people" on public.staff_members;
create policy "Owner or staff add people" on public.staff_members for insert
  with check ((select public.is_owner()) or ((select public.has_permission('staff', 'create')) and role_id is null));

drop policy if exists "Owner edits staff" on public.staff_members;
drop policy if exists "Owner or staff edit people" on public.staff_members;
create policy "Owner or staff edit people" on public.staff_members for update
  using ((select public.is_owner()) or (select public.has_permission('staff', 'edit')))
  with check ((select public.is_owner()) or (select public.has_permission('staff', 'edit')));

drop policy if exists "Owner or manager removes staff" on public.staff_members;
create policy "Owner or manager removes staff" on public.staff_members for delete
  using (
    ((select public.is_owner()) and coalesce(role_id, '') <> 'owner')
    or ((select public.current_staff_role()) = 'manager' and coalesce(role_id, '') not in ('owner', 'manager'))
    or ((select public.has_permission('staff', 'delete')) and role_id is null)
  );

-- Only the owner gives or changes a role, and changes a salary (a manager may edit the rest)
create or replace function public.guard_staff_changes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_owner() or current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if new.role_id is distinct from old.role_id then
    raise exception 'Only the owner gives or changes a role';
  end if;
  if new.salary_paise is distinct from old.salary_paise then
    raise exception 'Only the owner changes a salary';
  end if;
  return new;
end;
$$;

drop trigger if exists staff_members_guard_changes on public.staff_members;
create trigger staff_members_guard_changes
  before update on public.staff_members
  for each row execute function public.guard_staff_changes();

-- The owner's row: the same rule as before, now also for someone without a role (nobody becomes the owner
-- by an edit; only through a transfer with the owner's password)
create or replace function public.guard_owner_row()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('chiranvi.owner_change', true), '') = 'allowed' then
    return new;
  end if;
  if old.role_id is not distinct from 'owner' and (new.mobile_number <> old.mobile_number or new.role_id is distinct from 'owner') then
    raise exception 'The owner''s number and role change only through "Change number" with your password';
  end if;
  if new.role_id is not distinct from 'owner' and old.role_id is distinct from 'owner' then
    raise exception 'Someone becomes the owner only through a transfer with the owner''s password';
  end if;
  return new;
end;
$$;


-- 4. A new day for the Staff section -------------------------------------------------------------------------------
create or replace function public.start_staff_day()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not public.has_permission('staff', 'view') then
    return;
  end if;
  update public.staff_members
     set days_absent_this_month = case
           when date_trunc('month', today) <> date_trunc('month', attendance_date) then 0
           else days_absent_this_month + case when today_status = 'Present' then 0 else 1 end end,
         today_status = case when today_status = 'On leave' then 'On leave' else 'Present' end,
         attendance_date = today
   where attendance_date < today;
end;
$$;

revoke execute on function public.start_staff_day() from public, anon;
grant execute on function public.start_staff_day() to authenticated;
