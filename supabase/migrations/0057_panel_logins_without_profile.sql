-- =====================================================================================================
-- 0057 · Logins without a profile, and people a customer ordered for, for the Leads page
--   The Leads page (store/admin-leads-store.ts) makes a "Name not given" lead for each person who logged in
--   but never completed their Profile. panel_logins_without_profile() answers them: the login number
--   (10 digits) and when they first logged in, newest first. Not the team (they are not leads), and not
--   someone whose Profile is completed. Only for staff who may view Leads.
--   Read only: nothing is saved or changed. No new table.
-- Safe to run again.
-- =====================================================================================================

create or replace function public.panel_logins_without_profile()
returns table (mobile text, logged_in_at timestamptz)
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  if not coalesce((select public.has_permission('leads', 'view')), false) then
    raise exception 'You can''t see the leads' using errcode = '42501';
  end if;

  return query
  select logins.mobile, logins.logged_in_at
    from (
      select right(regexp_replace(coalesce(u.phone, ''), '\D', '', 'g'), 10) as mobile, u.created_at as logged_in_at
        from auth.users u
    ) logins
   where length(logins.mobile) = 10
     -- Their Profile is not completed (no customer row yet, or one without a completed Profile)
     and not exists (
       select 1 from public.customers c
        where c.mobile_number = logins.mobile and c.profile_completed_at is not null)
     -- The team are not leads
     and not exists (select 1 from public.staff_members s where s.mobile_number = logins.mobile)
   order by logins.logged_in_at desc;
end;
$$;
revoke execute on function public.panel_logins_without_profile() from public, anon;
grant execute on function public.panel_logins_without_profile() to authenticated;


-- =====================================================================================================
-- People a customer ordered for (Leads → "Ordered for someone")
--   A paid order delivered to someone else (another 10-digit number than the customer's own) makes that
--   person a lead: they have tasted the product. panel_order_recipients() answers one row per such number:
--   the name and address the order was delivered to, who ordered it, the order number and when (their
--   latest order). Not someone whose Profile is completed, and not the team. Only for staff who may view Leads.
--   Read only.
-- =====================================================================================================

create or replace function public.panel_order_recipients()
returns table (mobile text, name text, address text, ordered_by text, order_number text, ordered_at timestamptz)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not coalesce((select public.has_permission('leads', 'view')), false) then
    raise exception 'You can''t see the leads' using errcode = '42501';
  end if;

  return query
  select distinct on (recipients.mobile)
         recipients.mobile, recipients.name, recipients.address, recipients.ordered_by, recipients.order_number,
         recipients.ordered_at
    from (
      select right(regexp_replace(coalesce(o.delivery_mobile, ''), '\D', '', 'g'), 10) as mobile,
             -- "Name · address" as the order saved it
             trim(split_part(coalesce(o.deliver_to, ''), ' · ', 1)) as name,
             nullif(trim(substr(coalesce(o.deliver_to, ''), length(split_part(coalesce(o.deliver_to, ''), ' · ', 1)) + 4)), '') as address,
             coalesce(nullif(trim(o.customer_name), ''), 'A customer') as ordered_by,
             o.order_number,
             o.placed_at as ordered_at,
             o.customer_mobile
        from public.orders o
       where o.payment_status in ('paid', 'not_charged') and o.status <> 'cancelled'
    ) recipients
   where length(recipients.mobile) = 10
     and recipients.mobile <> coalesce(recipients.customer_mobile, '')
     and not exists (
       select 1 from public.customers c
        where c.mobile_number = recipients.mobile and c.profile_completed_at is not null)
     and not exists (select 1 from public.staff_members s where s.mobile_number = recipients.mobile)
   order by recipients.mobile, recipients.ordered_at desc;
end;
$$;
revoke execute on function public.panel_order_recipients() from public, anon;
grant execute on function public.panel_order_recipients() to authenticated;
