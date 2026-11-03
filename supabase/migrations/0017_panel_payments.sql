-- =====================================================================================================
-- 0017 · The panel's Payments page from the database (no more sample payments in the browser)
--   1. orders: razorpay_refund_id, refunded_at (a Razorpay refund of the order's payment).
--   2. manual_payments: money the panel records by hand (cash at the door, a bank transfer, a refund given
--      by hand). The only new table: nothing else holds a payment that has no website order.
--   3. panel_payments(): the Payments page's list (anyone with Payments → View):
--        one line per Razorpay payment (the orders paid together: a plan with items is one payment),
--        Success or Failed, with its order numbers; a refunded one also gets a Refund line; plus the
--        payments recorded by hand. Orders placed before online payments ("not charged") are not payments.
--   4. mark_checkout_refunded(): our payment server only (secret key), after Razorpay accepted the refund:
--      the order(s) become refunded and cancelled (nothing to deliver).
-- Money in paise in the tables; panel_payments() answers rupees. Safe to run again.
-- =====================================================================================================


-- 1. orders: refunds -------------------------------------------------------------------------------------------
alter table public.orders add column if not exists razorpay_refund_id text;
alter table public.orders add column if not exists refunded_at timestamptz;


-- 2. manual_payments ----------------------------------------------------------------------------------------------
create sequence if not exists public.manual_payment_number_seq start 90001;

create table if not exists public.manual_payments (
  id uuid primary key default gen_random_uuid(),
  payment_number text not null unique default ('TXN' || nextval('public.manual_payment_number_seq')),
  recorded_at timestamptz not null default now(),
  customer_name text not null check (length(trim(customer_name)) > 0),
  area text not null default '',
  payment_type text not null check (payment_type in ('Order', 'Subscription', 'Refund')),
  method text not null check (method in ('UPI', 'Net banking', 'Card', 'Cash')),
  amount_paise integer not null check (amount_paise <> 0),        -- money in positive, a refund negative
  recorded_by text not null default '',
  check ((payment_type = 'Refund') = (amount_paise < 0))
);

create index if not exists manual_payments_recorded_at_idx on public.manual_payments (recorded_at desc);

alter table public.manual_payments enable row level security;
revoke all on public.manual_payments from anon, authenticated;
grant select, insert on public.manual_payments to authenticated;
grant usage on sequence public.manual_payment_number_seq to authenticated;

drop policy if exists "Staff read manual payments" on public.manual_payments;
create policy "Staff read manual payments" on public.manual_payments for select
  using ((select public.has_permission('payments', 'view')));
drop policy if exists "Staff record payments" on public.manual_payments;
create policy "Staff record payments" on public.manual_payments for insert
  with check ((select public.has_permission('payments', 'create')));


-- 3. panel_payments(): the Payments page -----------------------------------------------------------------------
-- Answers [{id, paidAt (ms), customerName, area, type, method, amount (₹), status, websiteOrderId,
--           razorpayOrderId, razorpayPaymentId, isOnline}], newest first (the latest 2000).
create or replace function public.panel_payments()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.has_permission('payments', 'view') then
    raise exception 'You can''t see payments';
  end if;
  return coalesce((
    select jsonb_agg(line order by (line ->> 'paidAt')::bigint desc)
    from (
      select * from (
        -- One line per Razorpay payment
        select jsonb_build_object(
          'id', coalesce(max(o.razorpay_payment_id), o.razorpay_order_id),
          'paidAt', floor(extract(epoch from coalesce(max(o.paid_at), max(o.placed_at))) * 1000)::bigint,
          'customerName', min(o.customer_name),
          'area', min(o.area),
          'type', case when bool_or(o.subscription is not null) then 'Subscription' else 'Order' end,
          'method', min(o.payment_method),
          'amount', sum(o.total_paise) / 100.0,
          'status', case when bool_or(o.payment_status = 'failed') then 'Failed' else 'Success' end,
          'failureReason', max(o.payment_failure_reason),
          'websiteOrderId', string_agg(o.order_number, ', ' order by o.order_number),
          'razorpayOrderId', o.razorpay_order_id,
          'razorpayPaymentId', max(o.razorpay_payment_id),
          'isRefunded', bool_or(o.payment_status = 'refunded'),
          'isOnline', true) as line
        from public.orders o
        where o.razorpay_order_id is not null and o.payment_status in ('paid', 'failed', 'refunded')
        group by o.razorpay_order_id
        union all
        -- The refund of a refunded Razorpay payment
        select jsonb_build_object(
          'id', coalesce(max(o.razorpay_refund_id), 'refund-' || o.razorpay_order_id),
          'paidAt', floor(extract(epoch from max(o.refunded_at)) * 1000)::bigint,
          'customerName', min(o.customer_name),
          'area', min(o.area),
          'type', 'Refund',
          'method', min(o.payment_method),
          'amount', -sum(o.total_paise) / 100.0,
          'status', 'Success',
          'websiteOrderId', string_agg(o.order_number, ', ' order by o.order_number),
          'razorpayOrderId', o.razorpay_order_id,
          'isOnline', true) as line
        from public.orders o
        where o.razorpay_order_id is not null and o.payment_status = 'refunded'
        group by o.razorpay_order_id
        union all
        -- Recorded by hand in the panel
        select jsonb_build_object(
          'id', m.payment_number,
          'paidAt', floor(extract(epoch from m.recorded_at) * 1000)::bigint,
          'customerName', m.customer_name,
          'area', m.area,
          'type', m.payment_type,
          'method', m.method,
          'amount', m.amount_paise / 100.0,
          'status', 'Success',
          'recordedBy', m.recorded_by,
          'isOnline', false) as line
        from public.manual_payments m
      ) as every_line
      order by (line ->> 'paidAt')::bigint desc
      limit 2000
    ) as newest), '[]'::jsonb);
end;
$$;


-- 4. Refunds (our payment server only, after Razorpay accepted the refund) ---------------------------------------
create or replace function public.mark_checkout_refunded(p_razorpay_order_id text, p_razorpay_refund_id text)
returns integer
language sql security definer
set search_path = public
as $$
  with refunded as (
    update public.orders
       set payment_status = 'refunded', razorpay_refund_id = p_razorpay_refund_id, refunded_at = now(),
           status = 'cancelled',
           status_changed_at = coalesce(status_changed_at, '{}'::jsonb)
                               || jsonb_build_object('cancelled', floor(extract(epoch from now()) * 1000)::bigint)
     where razorpay_order_id = p_razorpay_order_id and payment_status = 'paid'
    returning 1
  )
  select count(*)::integer from refunded;
$$;


revoke execute on function public.panel_payments() from public, anon;
grant execute on function public.panel_payments() to authenticated;
revoke execute on function public.mark_checkout_refunded(text, text) from public, anon, authenticated;
grant execute on function public.mark_checkout_refunded(text, text) to service_role;
