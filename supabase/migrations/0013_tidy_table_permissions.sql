-- =====================================================================================================
-- 0013 · Tidy table permissions
--   Supabase gives every new table TRUNCATE (empty the whole table), REFERENCES and TRIGGER to the website's
--   roles by default. The website never uses them, and TRUNCATE skips the row rules (RLS), so they are taken
--   away from visitors (anon) and logged-in people (authenticated) on the tables that still had them.
--   Nothing the website does changes: reading, placing orders (place_order) and the panel's status changes
--   use their own permissions.
-- Safe to run again.
-- =====================================================================================================

revoke truncate, references, trigger on public.orders, public.order_items, public.coupons, public.coupon_redemptions
  from anon, authenticated;
