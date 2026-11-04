-- =====================================================================================================
-- 0024 · Real delivery agents join the agents list
--   Someone on the staff list (staff_members) who has the "Delivery agent" role gets an agent card in the
--   panel's agents list (panel_records, "agents"; 0019 / 0020), with their login number. Routes & agents can
--   then give them a route, the Orders page can give them orders, and their Delivery Panel finds their stops.
--   Only adds cards: nothing in panel_records is changed or deleted (the samples stay). A card is added once
--   per number (someone who already has a card keeps it). Two people with the same name: the second card
--   gets the last 4 digits of the number after the name, so the cards stay apart.
--   People who already have the role are added now.
-- Safe to run again.
-- =====================================================================================================

create or replace function private.add_delivery_agent_card(agent_mobile text, agent_name text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  card_name text := coalesce(nullif(trim(agent_name), ''), agent_mobile);
begin
  if agent_mobile !~ '^\d{10}$' then
    return;
  end if;
  -- Already has a card (their number is on it)
  if exists (select 1 from public.panel_records where module = 'agents' and owner_mobile = agent_mobile) then
    return;
  end if;
  -- The name is a card's id: a second person with the same name gets their number's last 4 digits too
  if exists (select 1 from public.panel_records where module = 'agents' and id = card_name) then
    card_name := card_name || ' · ' || right(agent_mobile, 4);
  end if;
  insert into public.panel_records (module, id, data, owner_mobile, is_sample)
  values ('agents', card_name,
          jsonb_build_object('id', card_name, 'name', card_name, 'phone', agent_mobile, 'bike', '—'),
          agent_mobile, false)
  on conflict (module, id) do nothing;
end;
$$;

create or replace function public.delivery_agent_gets_card()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.role_id = 'delivery-agent' and new.is_active then
    perform private.add_delivery_agent_card(new.mobile_number, new.name);
  end if;
  return new;
end;
$$;

drop trigger if exists staff_delivery_agent_card on public.staff_members;
create trigger staff_delivery_agent_card
  after insert or update of role_id, is_active on public.staff_members
  for each row execute function public.delivery_agent_gets_card();

-- People who already have the role
select private.add_delivery_agent_card(mobile_number, name)
  from public.staff_members
 where role_id = 'delivery-agent' and is_active;

revoke execute on function public.delivery_agent_gets_card() from public, anon, authenticated;
revoke execute on function private.add_delivery_agent_card(text, text) from public, anon, authenticated;
