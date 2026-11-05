-- =====================================================================================================
-- 0040 · Adding a customer as staff
--   customer_name_for_staff(): on Staff → Add staff, the number typed is checked: if it has a customer account,
--   this answers the name on it, so the panel can ask to continue with that account. Someone who may add staff
--   can't always read the customers list, so this answers that one name only, and only to the owner or to someone
--   who may add staff. Read only. No new table.
-- Safe to run again.
-- =====================================================================================================

create or replace function public.customer_name_for_staff(p_mobile text)
returns text
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not (public.is_owner() or public.has_permission('staff', 'create')) then
    raise exception 'You can''t add staff' using errcode = '42501';
  end if;
  return (select nullif(trim(c.first_name || ' ' || c.last_name), '')
            from public.customers c
           where c.mobile_number = p_mobile);
end;
$$;

revoke execute on function public.customer_name_for_staff(text) from public, anon;
grant execute on function public.customer_name_for_staff(text) to authenticated;
