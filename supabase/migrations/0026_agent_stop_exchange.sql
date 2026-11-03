-- =====================================================================================================
-- 0026 · Agents hand a stop to another agent (delivery exchange)
--   An agent may ask another agent who is on duty today to deliver one of their open stops. Agents can't
--   read or change each other's stops (0019 / 0020), so these checked steps do it:
--   - delivery_agents_to_ask(): the other agents on duty today (name, stops still to go);
--   - ask_agent_to_take_stop(stop, agent, reason): only the stop's own agent, an open stop, one request at a
--     time, to an agent on duty and not on leave. The stop stays theirs until it is accepted;
--   - my_stop_exchange_requests(): the requests waiting for me;
--   - answer_stop_exchange(stop, accept): only the asked agent. Accepted: the stop (and its number) goes to
--     them; declined: it stays (the asking agent delivers it). A finished stop can't be taken;
--   - my_sent_stop_exchanges(): today's stops I asked someone to take, with how it ended (waiting, accepted,
--     declined, taken back by the panel).
--   Kept on the stop itself (panel_records, "deliveries": transferRequest and history), as the panel's
--   Deliveries and Orders pages read them. No new table.
--   "Today" is the date in India.
-- Safe to run again.
-- =====================================================================================================

create or replace function private.india_today_key()
returns text
language sql stable
as $$ select to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') $$;

-- The logged-in delivery agent's number, or an error
create or replace function private.current_delivery_agent()
returns text
language plpgsql stable security definer
set search_path = public
as $$
declare
  me text := (select public.current_mobile());
begin
  if me is null or (select public.current_staff_role()) is distinct from 'delivery-agent' then
    raise exception 'Only delivery agents can do this' using errcode = '42501';
  end if;
  return me;
end;
$$;

-- Other agents on duty today, with their stops still to go
create or replace function public.delivery_agents_to_ask()
returns table (agent_name text, stops_to_go integer)
language plpgsql security definer
set search_path = public
as $$
declare
  me text := private.current_delivery_agent();
  today text := private.india_today_key();
begin
  return query
    select a.data ->> 'name',
           (select count(*)::integer from public.panel_records d
             where d.module = 'deliveries' and d.owner_mobile = a.owner_mobile and d.data ->> 'date' = today
               and d.data ->> 'status' in ('Pending', 'Out for delivery'))
      from public.panel_records a
      join public.panel_records day on day.module = 'agent-days' and day.id = a.owner_mobile || ':' || today
     where a.module = 'agents' and a.owner_mobile is not null and a.owner_mobile <> me
       and coalesce((a.data ->> 'isOnLeave')::boolean, false) = false
       and coalesce((day.data ->> 'isOnDuty')::boolean, false)
     order by 2, 1;
end;
$$;

create or replace function public.ask_agent_to_take_stop(stop_id text, to_agent text, reason text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  me text := private.current_delivery_agent();
  today text := private.india_today_key();
  stop_data jsonb;
  stop_owner text;
  to_mobile text;
  to_name text;
  asked_at text := to_jsonb(now()) #>> '{}';
begin
  select data, owner_mobile into stop_data, stop_owner
    from public.panel_records where module = 'deliveries' and id = stop_id for update;
  if stop_data is null or stop_owner is distinct from me then
    raise exception 'Not your stop' using errcode = '42501';
  end if;
  if stop_data ->> 'status' not in ('Pending', 'Out for delivery') then
    raise exception 'This stop is already finished';
  end if;
  if stop_data ? 'transferRequest' and stop_data -> 'transferRequest' <> 'null'::jsonb then
    raise exception 'You already asked someone to take this stop';
  end if;
  -- The other agent: on duty today and not on leave
  select a.owner_mobile, a.data ->> 'name' into to_mobile, to_name
    from public.panel_records a
    join public.panel_records day on day.module = 'agent-days' and day.id = a.owner_mobile || ':' || today
   where a.module = 'agents' and a.data ->> 'name' = to_agent and a.owner_mobile is not null and a.owner_mobile <> me
     and coalesce((a.data ->> 'isOnLeave')::boolean, false) = false
     and coalesce((day.data ->> 'isOnDuty')::boolean, false);
  if to_mobile is null then
    raise exception 'That agent is not on duty now';
  end if;

  update public.panel_records
     set data = data
           || jsonb_build_object('transferRequest', jsonb_build_object(
                'fromAgent', data ->> 'agent', 'fromMobile', me, 'toAgent', to_name, 'toMobile', to_mobile,
                'reason', coalesce(trim(reason), ''), 'requestedAt', asked_at))
           || jsonb_build_object('history', coalesce(data -> 'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                'kind', 'transfer-requested', 'at', asked_at, 'fromAgent', data ->> 'agent', 'fromMobile', me,
                'toAgent', to_name, 'reason', coalesce(trim(reason), ''))))
   where module = 'deliveries' and id = stop_id;
end;
$$;

-- Requests waiting for me (I can't read the stops themselves until I take them)
create or replace function public.my_stop_exchange_requests()
returns table (stop_id text, customer_name text, address text, slot text, order_number text, items jsonb,
               from_agent text, reason text, requested_at text)
language plpgsql security definer
set search_path = public
as $$
declare
  me text := private.current_delivery_agent();
begin
  return query
    select d.id, d.data ->> 'customerName', d.data ->> 'address', d.data ->> 'slot', d.data ->> 'orderNumber',
           coalesce(d.data -> 'items', '[]'::jsonb), d.data -> 'transferRequest' ->> 'fromAgent',
           d.data -> 'transferRequest' ->> 'reason', d.data -> 'transferRequest' ->> 'requestedAt'
      from public.panel_records d
     where d.module = 'deliveries' and d.data -> 'transferRequest' ->> 'toMobile' = me
       and d.data ->> 'status' in ('Pending', 'Out for delivery')
     order by d.data -> 'transferRequest' ->> 'requestedAt';
end;
$$;

-- Accept: the stop is mine (with my number); decline: it stays with the agent who asked
create or replace function public.answer_stop_exchange(stop_id text, accept boolean)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  me text := private.current_delivery_agent();
  stop_data jsonb;
  request jsonb;
  answered_at text := to_jsonb(now()) #>> '{}';
begin
  select data into stop_data from public.panel_records where module = 'deliveries' and id = stop_id for update;
  request := stop_data -> 'transferRequest';
  if request is null or request ->> 'toMobile' is distinct from me then
    raise exception 'This request is not for you (or it was taken back)' using errcode = '42501';
  end if;
  if stop_data ->> 'status' not in ('Pending', 'Out for delivery') then
    update public.panel_records set data = data - 'transferRequest' where module = 'deliveries' and id = stop_id;
    return 'finished';
  end if;

  update public.panel_records
     set data = (data - 'transferRequest')
           || jsonb_build_object('agent', case when accept then request ->> 'toAgent' else data ->> 'agent' end)
           || jsonb_build_object('history', coalesce(data -> 'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                'kind', case when accept then 'transfer-accepted' else 'transfer-declined' end, 'at', answered_at,
                'fromAgent', request ->> 'fromAgent', 'fromMobile', request ->> 'fromMobile', 'toAgent', request ->> 'toAgent'))),
         owner_mobile = case when accept then me else owner_mobile end
   where module = 'deliveries' and id = stop_id;
  return case when accept then 'accepted' else 'declined' end;
end;
$$;

-- Today's stops I asked someone to take, and how it ended
create or replace function public.my_sent_stop_exchanges()
returns table (stop_id text, customer_name text, order_number text, to_agent text, outcome text, at text)
language plpgsql security definer
set search_path = public
as $$
declare
  me text := private.current_delivery_agent();
  today text := private.india_today_key();
begin
  return query
    select d.id, d.data ->> 'customerName', d.data ->> 'orderNumber', last_event ->> 'toAgent',
           case
             when d.data -> 'transferRequest' ->> 'fromMobile' = me then 'waiting'
             when last_event ->> 'kind' = 'transfer-accepted' then 'accepted'
             when last_event ->> 'kind' = 'transfer-declined' then 'declined'
             else 'cancelled'
           end,
           last_event ->> 'at'
      from public.panel_records d
      cross join lateral (
        select event from jsonb_array_elements(coalesce(d.data -> 'history', '[]'::jsonb)) with ordinality as e(event, position)
         where event ->> 'fromMobile' = me or (event ->> 'kind' = 'transfer-cancelled' and event ->> 'fromAgent' = (
                 select a.data ->> 'name' from public.panel_records a where a.module = 'agents' and a.owner_mobile = me limit 1))
         order by position desc limit 1
      ) as latest(last_event)
     where d.module = 'deliveries' and d.data ->> 'date' = today
     order by last_event ->> 'at' desc;
end;
$$;

revoke execute on function private.india_today_key() from public, anon, authenticated;
revoke execute on function private.current_delivery_agent() from public, anon, authenticated;
revoke execute on function public.delivery_agents_to_ask() from public, anon;
revoke execute on function public.ask_agent_to_take_stop(text, text, text) from public, anon;
revoke execute on function public.my_stop_exchange_requests() from public, anon;
revoke execute on function public.answer_stop_exchange(text, boolean) from public, anon;
revoke execute on function public.my_sent_stop_exchanges() from public, anon;
grant execute on function public.delivery_agents_to_ask() to authenticated;
grant execute on function public.ask_agent_to_take_stop(text, text, text) to authenticated;
grant execute on function public.my_stop_exchange_requests() to authenticated;
grant execute on function public.answer_stop_exchange(text, boolean) to authenticated;
grant execute on function public.my_sent_stop_exchanges() to authenticated;
