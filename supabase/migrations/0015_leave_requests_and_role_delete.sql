-- =====================================================================================================
-- 0015 · Leave requests in the database, deleting a role with the owner's PIN / password, and managers
--        removing people from the team
--   1. leave_requests: a team member's leave (type, dates, reason, an attached document) and the
--      decision. Shown on Roles & permissions → Staff (each person's leave, with Approve / Reject) and on
--      the Staff page. Kept by the person's login number (staff_members.mobile_number); removing someone
--      from the team removes their requests too.
--        read:    the person themselves, or anyone with Staff → View
--        add:     the person themselves, for themselves, as Pending (the staff app, later)
--        decide:  anyone with Staff → Edit
--   2. delete_panel_role(): a role (Manager, Staff, or one the owner made) is deleted only by the owner, only
--      right after their PIN / password check (the same check as Transfer ownership), and only when nobody
--      has it. Owner and Delivery agent (the delivery app needs it) are never deleted.
--   3. Removing a person from the team (Roles & permissions → Staff): the owner removes anyone but the
--      owner; a manager removes anyone who isn't the owner or a manager.
--   4. decline_account_deletion(): the same people reject a request to delete an account.
-- Safe to run again.
-- =====================================================================================================


-- 1. Leave requests ------------------------------------------------------------------------------------
create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  staff_mobile text not null references public.staff_members (mobile_number) on update cascade on delete cascade,
  leave_type text not null check (leave_type in ('Casual', 'Sick', 'Earned', 'Emergency', 'Half day', 'Unpaid')),
  from_date date not null,
  to_date date not null,
  reason text not null default '',
  attachment jsonb,                                   -- {fileName, label, issuedBy}
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected')),
  applied_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,                                    -- the name of who decided
  reject_reason text,
  check (to_date >= from_date)
);

create index if not exists leave_requests_staff_mobile_idx on public.leave_requests (staff_mobile, applied_at desc);
create index if not exists leave_requests_pending_idx on public.leave_requests (status) where status = 'Pending';

alter table public.leave_requests enable row level security;
-- Only what the website uses (Supabase gives new tables more by default; see 0013)
revoke all on public.leave_requests from anon, authenticated;
grant select, insert, update on public.leave_requests to authenticated;

drop policy if exists "Own leave or the team's" on public.leave_requests;
create policy "Own leave or the team's" on public.leave_requests for select
  using (staff_mobile = (select public.current_mobile()) or (select public.has_permission('staff', 'view')));
drop policy if exists "Ask for own leave" on public.leave_requests;
create policy "Ask for own leave" on public.leave_requests for insert
  with check (staff_mobile = (select public.current_mobile()) and status = 'Pending' and decided_at is null);
drop policy if exists "Staff decide leave" on public.leave_requests;
create policy "Staff decide leave" on public.leave_requests for update
  using ((select public.has_permission('staff', 'edit'))) with check ((select public.has_permission('staff', 'edit')));


-- 2. Deleting a role -------------------------------------------------------------------------------------
create or replace function public.delete_panel_role(role_to_delete text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  found_role public.panel_roles;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can delete a role';
  end if;
  if not public.has_recent_password_check() then
    raise exception 'Confirm with your PIN or password first';
  end if;
  select * into found_role from public.panel_roles where id = role_to_delete;
  if found_role.id is null then
    raise exception 'That role doesn''t exist any more';
  end if;
  if found_role.id in ('owner', 'delivery-agent') then
    raise exception '% can''t be deleted', found_role.name;
  end if;
  if exists (select 1 from public.staff_members where role_id = role_to_delete) then
    raise exception 'Move the people with % to another role first', found_role.name;
  end if;
  delete from public.panel_roles where id = role_to_delete;
  insert into public.activity_log (actor_id, actor_name, action, target_table, target_id)
  values (auth.uid(), (select name from public.staff_members where role_id = 'owner'), 'role.deleted', 'panel_roles', role_to_delete);
end;
$$;

revoke execute on function public.delete_panel_role(text) from public, anon;
grant execute on function public.delete_panel_role(text) to authenticated;


-- 3. Who removes people from the team --------------------------------------------------------------------
drop policy if exists "Owner removes staff" on public.staff_members;
drop policy if exists "Owner or manager removes staff" on public.staff_members;
create policy "Owner or manager removes staff" on public.staff_members for delete
  using (
    ((select public.is_owner()) and role_id <> 'owner')
    or ((select public.current_staff_role()) = 'manager' and role_id not in ('owner', 'manager'))
  );


-- 4. Rejecting a request to delete an account (Roles & permissions → Staff → the request → Reject) ----------
-- The same people who can remove that person: the owner, or a manager for anyone who isn't the owner or a
-- manager. The request is cleared (the person can ask again) and written to activity_log.
create or replace function public.decline_account_deletion(staff_mobile text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  member public.staff_members;
begin
  select * into member from public.staff_members s where s.mobile_number = staff_mobile;
  if member.mobile_number is null then
    raise exception 'That person isn''t on the team any more';
  end if;
  if not (public.is_owner() or (public.current_staff_role() = 'manager' and member.role_id not in ('owner', 'manager'))) then
    raise exception 'Only the owner or a manager can reject this request';
  end if;
  update public.staff_members set delete_requested_at = null where mobile_number = staff_mobile;
  insert into public.activity_log (actor_id, actor_name, action, target_table, target_id)
  values (auth.uid(), (select name from public.staff_members where mobile_number = public.current_mobile()),
          'account.delete_request_declined', 'staff_members', staff_mobile);
end;
$$;

revoke execute on function public.decline_account_deletion(text) from public, anon;
grant execute on function public.decline_account_deletion(text) to authenticated;
