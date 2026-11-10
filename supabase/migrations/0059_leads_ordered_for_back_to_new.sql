-- =====================================================================================================
-- 0059 · Leads: "Ordered for someone" is a type, not a status
--   The Leads page became a table (store/admin-leads-store.ts, components/admin/admin-leads-page.tsx): the
--   status is New, Contacted, Converted or Lost, and "Ordered for someone" is the lead's type (its kind).
--   Leads that 0058 put in the "ordered-for" stage go back to New. Changes only their stage. No table change.
-- Safe to run again.
-- =====================================================================================================

update public.panel_records
   set data = data || '{"stage": "new"}'::jsonb
 where module = 'leads' and data ->> 'stage' = 'ordered-for';
