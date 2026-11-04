-- =====================================================================================================
-- 0033 · Marking an agent's request resolved
--   Agents raise requests to the manager from a stop; they are kept in the agent's day (panel_records,
--   "agent-days"). resolve_agent_request(): the owner or anyone with Deliveries → Edit marks one Resolved.
--   It changes only that request, so the agent's stop progress in the same record is left alone. The agent
--   sees it in their Delivery Panel. No new table.
-- Safe to run again.
-- =====================================================================================================

create or replace function public.resolve_agent_request(day_id text, request_id text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  resolver text;
begin
  if not ((select public.is_owner()) or (select public.has_permission('deliveries', 'edit'))) then
    raise exception 'You can''t resolve agent requests' using errcode = '42501';
  end if;
  select name into resolver from public.staff_members where mobile_number = (select public.current_mobile());

  update public.panel_records d
     set data = jsonb_set(d.data, '{requests}', (
           select jsonb_agg(
                    case when request ->> 'id' = request_id
                         then request || jsonb_build_object('status', 'Resolved', 'resolvedBy', resolver, 'resolvedAt', to_jsonb(now()))
                         else request end
                    order by position)
             from jsonb_array_elements(d.data -> 'requests') with ordinality as r(request, position)))
   where d.module = 'agent-days' and d.id = day_id
     and exists (select 1 from jsonb_array_elements(d.data -> 'requests') as r(request) where request ->> 'id' = request_id);
  if not found then
    raise exception 'That request is no longer there';
  end if;
end;
$$;

revoke execute on function public.resolve_agent_request(text, text) from public, anon;
grant execute on function public.resolve_agent_request(text, text) to authenticated;
