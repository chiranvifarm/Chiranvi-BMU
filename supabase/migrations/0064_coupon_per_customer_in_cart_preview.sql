-- =====================================================================================================
-- 0064 · Coupons: show the per-customer "already used" message in the cart preview
--   0063 added the per_customer_limit column + a trigger that blocks the order at placement. This also
--   shows it earlier, in the cart's coupon check (public.check_coupon), so the customer sees
--   "You have already used X the most times allowed." before paying, not only when the order is placed.
--   This is public.check_coupon rebuilt exactly as 0012 defined it, with ONE added block (the per-customer
--   check). Nothing else in the function changes.
-- Safe to run again.
-- =====================================================================================================

create or replace function public.check_coupon(code text, cart jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  lines jsonb := '[]'::jsonb;
  item jsonb;
  line record;
  plan_line record;
  result record;
  plan_error text;
  typed_code text := upper(trim(coalesce(code, '')));
begin
  if auth.uid() is null then
    return jsonb_build_object('error', 'Log in to use a coupon');
  end if;
  if typed_code = '' then
    return jsonb_build_object('error', 'Enter a coupon code');
  end if;
  -- A code the owner didn't put in this cart's list
  if exists (select 1 from public.coupons c where c.code = typed_code and not (private.cart_type(cart) = any (c.cart_types))) then
    return jsonb_build_object('error', typed_code || ' can''t be used on this order');
  end if;
  -- Per-customer limit (0063/0064): this customer has already used it the most times allowed
  if exists (
    select 1 from public.coupons c
    where c.code = typed_code and c.per_customer_limit is not null
      and (select count(*) from public.orders o
           where o.customer_mobile = public.current_mobile()
             and o.coupon_code = typed_code
             and o.payment_status in ('paid', 'not_charged')) >= c.per_customer_limit
  ) then
    return jsonb_build_object('error', 'You have already used ' || typed_code || ' the most times allowed');
  end if;
  for item in select value from jsonb_array_elements(coalesce(cart -> 'items', '[]'::jsonb)) limit 50 loop
    select * into line from private.cart_line(item ->> 'productId');
    if line.unit_paise is not null then
      lines := lines || jsonb_build_array(jsonb_build_object(
        'amountPaise', line.unit_paise * greatest(1, least(99, coalesce((item ->> 'quantity')::integer, 1))),
        'category', line.category));
    end if;
  end loop;

  if jsonb_typeof(cart -> 'plan') = 'object' then
    begin
      select * into plan_line from private.plan_price(cart -> 'plan' ->> 'productId', cart -> 'plan' ->> 'planId',
                                                     (cart -> 'plan' ->> 'months')::integer, (cart -> 'plan' ->> 'days')::integer,
                                                     (cart -> 'plan' ->> 'bottlesPerDay')::integer);
      select * into result from private.coupon_discount(typed_code, null, plan_line.plan_total_paise, plan_line.price_per_bottle_paise,
                                                        (cart -> 'plan' ->> 'bottlesPerDay')::integer);
      return jsonb_build_object('code', result.code, 'discount', result.discount_paise / 100.0, 'isForPlan', true,
        'description', (select c.description from public.coupons c where c.code = result.code));
    exception when sqlstate 'P0001' then
      plan_error := sqlerrm;
    end;
    if jsonb_array_length(lines) = 0 then
      return jsonb_build_object('error', plan_error);
    end if;
  end if;

  begin
    select * into result from private.coupon_discount(typed_code, lines, null, null, null);
    return jsonb_build_object('code', result.code, 'discount', result.discount_paise / 100.0, 'isForPlan', false,
      'description', (select c.description from public.coupons c where c.code = result.code));
  exception when sqlstate 'P0001' then
    return jsonb_build_object('error', coalesce(plan_error, sqlerrm));
  end;
end;
$$;
