-- =====================================================================================================
-- 0058 · Leads board: "Ordered for someone" takes the place of "Free trial"
--   The board is now New · Contacted · Ordered for someone · Converted · Lost (store/admin-leads-store.ts).
--   1. Leads still in the old Free trial column move to Contacted (and lose their trial end date).
--   2. Leads made for someone a customer ordered for (kind "ordered-for") that are still New move to the
--      Ordered for someone column, where such leads now start.
--   Changes only the leads' stage. No table change.
-- Safe to run again.
-- =====================================================================================================

update public.panel_records
   set data = (data - 'trialEndsAt') || '{"stage": "contacted"}'::jsonb
 where module = 'leads' and data ->> 'stage' = 'trial';

update public.panel_records
   set data = data || '{"stage": "ordered-for"}'::jsonb
 where module = 'leads' and data ->> 'kind' = 'ordered-for' and data ->> 'stage' = 'new';
