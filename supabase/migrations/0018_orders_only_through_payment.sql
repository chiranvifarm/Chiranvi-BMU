-- =====================================================================================================
-- 0018 · Orders only through a payment
--   place_order() saved an order straight away, without taking money. 0016 left it callable so the old live
--   site kept working while Razorpay was being switched on; the website now uses start_checkout() + Razorpay
--   (app/api/payments/*), so nobody needs it any more. Logged-in browsers can no longer run it: an order is
--   created only by start_checkout() (saved "awaiting payment", hidden) and counts only once our server has
--   confirmed the Razorpay payment (mark_checkout_paid). The function itself stays (its pricing lives on in
--   private.save_order()).
-- Safe to run again.
-- =====================================================================================================

revoke execute on function public.place_order(jsonb) from public, anon, authenticated;
