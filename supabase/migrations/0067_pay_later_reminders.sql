-- =====================================================================================================
-- 0067 · Pay-later reminders (in-app)
--   Staff on the panel's "Pay later" page can nudge a customer whose plan payment is still due. The nudge
--   is stored on the order (payment_reminded_at); the customer sees a reminder pop-up in their account.
--     1. orders.payment_reminded_at - when the customer was last reminded.
--     2. remind_pay_later() - staff with Subscriptions edit set payment_reminded_at on a pay-later order.
--   Safe to run again. (An SMS reminder can be added later on top of this.)
-- =====================================================================================================

alter table public.orders add column if not exists payment_reminded_at timestamptz;

create or replace function public.remind_pay_later(p_order_number text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  the_checkout uuid;
  cust text;
begin
  if not public.has_permission('subscriptions', 'edit') then
    raise exception 'You do not have permission to send reminders';
  end if;
  select checkout_id, customer_name into the_checkout, cust
  from public.orders
  where order_number = replace(p_order_number, '#', '') and payment_status = 'pay_later'
  limit 1;
  if the_checkout is null then
    raise exception 'No pay-later order to remind';
  end if;
  update public.orders set payment_reminded_at = now()
  where checkout_id = the_checkout and payment_status = 'pay_later';
  return jsonb_build_object('customerName', cust);
end;
$$;

revoke execute on function public.remind_pay_later(text) from public, anon;
grant execute on function public.remind_pay_later(text) to authenticated;
