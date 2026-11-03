-- =====================================================================================================
-- 0023 · Remove place_order()
--   place_order() saved an order without taking money (from before online payments). 0018 locked it; nothing
--   calls it any more (no website code, no other database function), so it is removed. Orders are created
--   only by start_checkout() and become real once Razorpay's payment is confirmed (mark_checkout_paid). Its
--   pricing stays in private.save_order(), which start_checkout() uses.
--   Older migrations still show place_order(): they are the history of what was done, never edited.
-- Safe to run again.
-- =====================================================================================================

drop function if exists public.place_order(jsonb);
