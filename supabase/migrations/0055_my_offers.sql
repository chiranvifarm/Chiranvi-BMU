-- =====================================================================================================
-- 0055 · My Offers: the coupons a logged-in customer can see
--   Customers can't read the coupons table (codes stay private from visitors), so my_offers() answers, for a
--   logged-in person only:
--     available  every running coupon the admin made: not paused, started, not past its last day, uses left
--     used       the coupons this person used on their own orders (newest first), with the day and the saving
--   Read only: nothing is saved or changed. No new table.
-- Safe to run again.
-- =====================================================================================================

create or replace function public.my_offers()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  me text := (select public.current_mobile());
begin
  if auth.uid() is null or me is null then
    return jsonb_build_object('available', '[]'::jsonb, 'used', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'available', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', c.code, 'description', c.description, 'kind', c.kind, 'value', c.value,
               'minOrder', c.min_order, 'appliesTo', c.applies_to, 'validTill', c.valid_till)
             order by c.created_at desc)
        from public.coupons c
       where not c.is_paused and c.valid_from <= today
         and (c.valid_till is null or c.valid_till >= today)
         and (c.usage_limit is null or c.used < c.usage_limit)), '[]'::jsonb),
    'used', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', r.code, 'description', coalesce(c.description, ''), 'kind', c.kind, 'value', c.value,
               'usedOn', (r.redeemed_at at time zone 'Asia/Kolkata')::date, 'saving', r.discount_paise / 100.0,
               'orderNumber', r.order_number)
             order by r.redeemed_at desc)
        from public.coupon_redemptions r
        join public.orders o on o.order_number = r.order_number
        left join public.coupons c on c.code = r.code
       where o.customer_mobile = me), '[]'::jsonb));
end;
$$;
revoke execute on function public.my_offers() from public, anon;
grant execute on function public.my_offers() to authenticated;
