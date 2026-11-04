-- =====================================================================================================
-- 0030 · The delivery samples are removed
--   Only real delivery data from now on: the sample agents, routes and deliveries (is_sample) go, and the
--   website no longer makes them. Real records stay, and so do the other pages' samples (orders,
--   subscriptions, refunds, leads, pause requests, reports).
-- Safe to run again.
-- =====================================================================================================

delete from public.panel_records where module in ('agents', 'routes', 'deliveries') and is_sample;
