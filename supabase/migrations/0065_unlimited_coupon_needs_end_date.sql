-- =====================================================================================================
-- 0065 · Coupons: an unlimited coupon must have an end date (referral coupons are exempt)
--   The panel already stops you saving a no-total-limit coupon with no expiry. This guards it in the
--   database too: a coupon with usage_limit null AND valid_till null is rejected, UNLESS it is a referral
--   coupon (kind = 'referral'), which is meant to run forever (e.g. REFER100).
--   A BEFORE INSERT OR UPDATE trigger on public.coupons; existing rows are untouched until they are edited,
--   and the only unlimited+no-expiry coupon today (REFER100) is a referral, so nothing is blocked.
-- Safe to run again.
-- =====================================================================================================

create or replace function private.coupon_needs_end_date()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.usage_limit is null and new.valid_till is null and new.kind <> 'referral' then
    raise exception 'An unlimited coupon needs an end date.'
      using errcode = 'P0001', hint = 'expiry';
  end if;
  return new;
end;
$$;

drop trigger if exists coupons_unlimited_needs_end_date on public.coupons;
create trigger coupons_unlimited_needs_end_date
  before insert or update on public.coupons
  for each row
  execute function private.coupon_needs_end_date();
