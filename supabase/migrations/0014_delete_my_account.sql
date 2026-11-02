-- =====================================================================================================
-- 0014 · Delete my account (Profile page → "Delete account")
--   my_account_delete_check(): what the Profile page's pop-up shows before anything is deleted:
--     {teamRole, isOwner, deleteRequestedAt, hasRunningPlan, hasUndeliveredOrder}
--   delete_my_account(): the logged-in customer deletes their account for good:
--     - refused for team members (owner, admin, managers, staff, delivery agents), even with an empty cart:
--       only an admin removes them, on Roles & permissions, so nobody locks the panel out by mistake;
--     - refused while a milk plan is still running (its days, plus any extensions, not over yet);
--     - refused while a one-time order isn't delivered (or cancelled) yet;
--     - otherwise: the customer row goes (its addresses go with it), their "Notify me" requests go, and
--       the login itself (auth.users, with its sessions) goes. Past orders stay for the sales records,
--       no longer linked to a customer (orders.customer_id becomes empty).
--   request_my_account_deletion(): a team member (not the owner) asks the admin to delete their account:
--     staff_members.delete_requested_at is set (Roles & permissions shows it beside their name) and the
--     request is written to activity_log. cancel_my_account_deletion_request() takes it back.
--   The cart is in the browser, so "empty the cart first" is checked on the Profile page.
--   Messages are for the customer; hint says which rule refused it ('staff', 'plan', 'orders').
-- Safe to run again.
-- =====================================================================================================

alter table public.staff_members add column if not exists delete_requested_at timestamptz;


-- What stops this login number deleting its account (used by the check and by the delete itself)
create or replace function private.account_delete_blockers(p_mobile text)
returns table (team_role text, is_owner boolean, delete_requested_at timestamptz, has_running_plan boolean, has_undelivered_order boolean)
language sql stable
set search_path = public
as $$
  select
    (select coalesce(r.name, s.role_id) from public.staff_members s left join public.panel_roles r on r.id::text = s.role_id::text
      where s.mobile_number = p_mobile),
    exists (select 1 from public.staff_members s where s.mobile_number = p_mobile and s.role_id = 'owner'),
    (select s.delete_requested_at from public.staff_members s where s.mobile_number = p_mobile),
    -- A milk plan still running: its first delivery day + its days + the days of its extensions, not over yet
    exists (
      select 1
      from public.orders plan_order
      where plan_order.customer_mobile = p_mobile
        and plan_order.subscription is not null
        and plan_order.status <> 'cancelled'
        and coalesce(plan_order.subscription ->> 'extendsOrderId', '') = ''
        and (plan_order.promised_at at time zone 'Asia/Kolkata')::date
            + coalesce((plan_order.subscription ->> 'days')::integer, 0)
            + coalesce((
                select sum((extension.subscription ->> 'days')::integer)::integer
                from public.orders extension
                where extension.customer_mobile = p_mobile
                  and extension.status <> 'cancelled'
                  and extension.subscription ->> 'extendsOrderId' = plan_order.order_number), 0)
            > (now() at time zone 'Asia/Kolkata')::date),
    -- A one-time order on its way
    exists (
      select 1 from public.orders o
      where o.customer_mobile = p_mobile and o.subscription is null and o.status not in ('delivered', 'cancelled'));
$$;


create or replace function public.my_account_delete_check()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  mobile text := public.current_mobile();
  blockers record;
begin
  if auth.uid() is null or coalesce(mobile, '') !~ '^\d{10}$' then
    raise exception 'Log in again to delete your account';
  end if;
  select * into blockers from private.account_delete_blockers(mobile);
  return jsonb_build_object(
    'teamRole', blockers.team_role,
    'isOwner', blockers.is_owner,
    'deleteRequestedAt', blockers.delete_requested_at,
    'hasRunningPlan', blockers.has_running_plan,
    'hasUndeliveredOrder', blockers.has_undelivered_order);
end;
$$;


create or replace function public.delete_my_account()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  user_id uuid := auth.uid();
  mobile text := public.current_mobile();
  blockers record;
begin
  if user_id is null or coalesce(mobile, '') !~ '^\d{10}$' then
    raise exception 'Log in again to delete your account';
  end if;
  select * into blockers from private.account_delete_blockers(mobile);
  if blockers.team_role is not null then
    raise exception 'You''re on the Chiranvi team, you can''t delete your account' using hint = 'staff';
  end if;
  if blockers.has_running_plan then
    raise exception 'You have a milk plan running. You can delete your account after it ends.' using hint = 'plan';
  end if;
  if blockers.has_undelivered_order then
    raise exception 'You have an order that isn''t delivered yet. You can delete your account after it is delivered.' using hint = 'orders';
  end if;

  delete from public.restock_requests where mobile_number = mobile;
  delete from public.customers where mobile_number = mobile;   -- addresses go with it; orders stay, unlinked
  delete from auth.users where id = user_id;                   -- the login and its sessions
end;
$$;


create or replace function public.request_my_account_deletion()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  mobile text := public.current_mobile();
  member public.staff_members;
begin
  select * into member from public.staff_members s where s.mobile_number = mobile;
  if auth.uid() is null or member.mobile_number is null then
    raise exception 'Only team members send this request';
  end if;
  if member.role_id = 'owner' then
    raise exception 'The owner''s account can''t be deleted. Transfer the ownership first.';
  end if;
  update public.staff_members set delete_requested_at = now() where mobile_number = mobile;
  insert into public.activity_log (actor_id, actor_name, action, target_table, target_id)
  values (auth.uid(), member.name, 'account.delete_requested', 'staff_members', mobile);
end;
$$;


-- The team member changed their mind: the request is taken back (and written to activity_log)
create or replace function public.cancel_my_account_deletion_request()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  mobile text := public.current_mobile();
  member public.staff_members;
begin
  select * into member from public.staff_members s where s.mobile_number = mobile;
  if auth.uid() is null or member.mobile_number is null then
    raise exception 'Only team members send this request';
  end if;
  update public.staff_members set delete_requested_at = null where mobile_number = mobile;
  insert into public.activity_log (actor_id, actor_name, action, target_table, target_id)
  values (auth.uid(), member.name, 'account.delete_request_cancelled', 'staff_members', mobile);
end;
$$;


revoke execute on function public.delete_my_account(), public.my_account_delete_check(), public.request_my_account_deletion(),
  public.cancel_my_account_deletion_request() from public, anon;
grant execute on function public.delete_my_account(), public.my_account_delete_check(), public.request_my_account_deletion(),
  public.cancel_my_account_deletion_request() to authenticated;
