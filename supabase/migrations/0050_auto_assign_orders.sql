-- =====================================================================================================
-- 0050 · Paid orders go to their route's agent by themselves
--   1. When an order is paid, the database gives it to the agent on the route of its area: the same stop as
--      "Assign agent" on the Orders page makes, marked isAutoAssigned, so it works with nobody online.
--      The order stays Placed: nothing has been packed yet. It moves on when staff pack it or the agent picks it up.
--   2. No route for that area, no agent on the route, or the agent is on leave: no stop is made. The Orders page
--      and the bell show "Needs an agent", and staff assign it by hand as before.
--      An extended plan gets no stop: its plan already has one every day.
--   3. A cancelled or refunded order's open stop goes, so an agent never carries a cancelled order.
--   4. A plan's first delivery is the morning after it is paid. The stop made on the day it was paid (by this, or by
--      hand) is that first delivery, so create_todays_plan_stops() now moves it to that morning instead of
--      marking it Missed. It is the one the database had (0047), changed only in that.
--   No new table.
-- Safe to run again.
-- =====================================================================================================


-- 1-2. Paid: its route's agent gets the stop -------------------------------------------------------------
create or replace function private.auto_assign_order(paid public.orders)
returns void
language plpgsql
set search_path = public
as $$
declare
  today_key text := private.india_today_key();
  the_route public.panel_records;
  the_agent public.panel_records;
  items jsonb;
  stop_id text := 'D-' || replace(today_key, '-', '') || '-' || paid.order_number;
  stop_data jsonb;
begin
  if coalesce(paid.subscription ->> 'extendsOrderId', '') <> '' then
    return;
  end if;
  if exists (select 1 from public.panel_records d where d.module = 'deliveries' and d.data ->> 'orderNumber' = '#' || paid.order_number) then
    return;
  end if;
  select r.* into the_route from public.panel_records r
   where r.module = 'routes' and lower(trim(r.data ->> 'area')) = lower(trim(paid.area))
   order by r.sort_order, r.id
   limit 1;
  if the_route.id is null or coalesce(the_route.data ->> 'agent', '') = '' then
    return;
  end if;
  select a.* into the_agent from public.panel_records a where a.module = 'agents' and a.id = the_route.data ->> 'agent';
  if the_agent.id is null or coalesce((the_agent.data ->> 'isOnLeave')::boolean, false) or coalesce(the_agent.owner_mobile, '') !~ '^\d{10}$' then
    return;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'packSize', i.pack_size, 'quantity', i.quantity, 'price', i.price_paise / 100.0) order by i.position), '[]'::jsonb)
    into items
  from public.order_items i where i.order_id = paid.id;
  -- A milk plan's stop is one day's bottles, not the whole plan
  if paid.subscription is not null then
    items := private.one_day_items(items, paid.subscription);
  end if;

  stop_data := jsonb_strip_nulls(jsonb_build_object(
    'id', stop_id,
    'date', today_key,
    'orderNumber', '#' || paid.order_number,
    -- "Name · #12, 4th Cross, Kengeri": who receives it, and where
    'customerName', coalesce(nullif(trim(split_part(paid.deliver_to, ' · ', 1)), ''), paid.customer_name),
    'address', coalesce(nullif(trim(substr(paid.deliver_to, length(split_part(paid.deliver_to, ' · ', 1)) + 4)), ''), paid.area),
    'phone', coalesce(paid.delivery_mobile, paid.customer_mobile),
    'area', paid.area,
    'routeId', the_route.id,
    'agent', the_agent.id,
    'slot', '6–7 AM',
    'status', 'Pending',
    'isSubscription', paid.subscription is not null,
    'isAutoAssigned', true,
    'items', items,
    'cashToCollect', 0,
    'latitude', paid.delivery_latitude,
    'longitude', paid.delivery_longitude,
    'history', jsonb_build_array(jsonb_build_object('kind', 'assigned', 'at', to_jsonb(now()), 'toAgent', the_agent.id))));
  insert into public.panel_records (module, id, data, owner_mobile, is_sample)
  values ('deliveries', stop_id, stop_data, the_agent.owner_mobile, false)
  on conflict do nothing;
end;
$$;

-- 3. Cancelled or refunded: its open stop goes
create or replace function public.order_stop_follows()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.payment_status = 'paid' and old.payment_status is distinct from 'paid' and new.status <> 'cancelled' then
    perform private.auto_assign_order(new);
  end if;
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    delete from public.panel_records d
     where d.module = 'deliveries' and d.data ->> 'orderNumber' = '#' || new.order_number
       and d.data ->> 'status' in ('Pending', 'Out for delivery');
  end if;
  return null;
end;
$$;

drop trigger if exists orders_stop_follows on public.orders;
create trigger orders_stop_follows
  after update of payment_status, status on public.orders
  for each row execute function public.order_stop_follows();

revoke execute on function public.order_stop_follows() from public, anon, authenticated;
revoke execute on function private.auto_assign_order(public.orders) from public, anon, authenticated;


-- 4. The stop made the day a plan was paid is its first morning's -----------------------------------------
CREATE OR REPLACE FUNCTION public.create_todays_plan_stops()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  today_key text := to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD');
  plan public.orders;
  last_stop public.panel_records;
  new_id text;
  added integer := 0;
begin
  if not coalesce((select public.current_staff_role()) = 'delivery-agent' or (select public.has_permission('deliveries', 'view')), false) then
    raise exception 'You can''t see the deliveries' using errcode = '42501';
  end if;

  for plan in
    select * from public.orders o
     where o.subscription is not null and o.status <> 'cancelled' and not (o.subscription ? 'extendsOrderId')
  loop
    -- The plan's agent: the one on its last stop. No stop yet: no agent has been given
    select * into last_stop from public.panel_records d
     where d.module = 'deliveries' and d.owner_mobile is not null and d.data ->> 'orderNumber' = '#' || plan.order_number
     order by d.data ->> 'date' desc, d.created_at desc
     limit 1;
    continue when last_stop.id is null;

    update public.panel_records
       set data = data || '{"status": "Missed"}'::jsonb
     where module = 'deliveries' and data ->> 'orderNumber' = '#' || plan.order_number
       and data ->> 'date' < today_key and data ->> 'status' in ('Pending', 'Out for delivery')
       and data ->> 'date' <> to_char((plan.placed_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD');

    continue when today <= (plan.placed_at at time zone 'Asia/Kolkata')::date or today > private.plan_last_day(plan);
    continue when exists (
      select 1 from public.panel_records p
       where p.module = 'pause-requests' and p.data ->> 'status' = 'Approved' and p.data ->> 'websiteOrderId' = plan.order_number
         and today >= ((p.data ->> 'pauseFrom')::timestamptz at time zone 'Asia/Kolkata')::date
         and today < ((p.data ->> 'resumeOn')::timestamptz at time zone 'Asia/Kolkata')::date);
    -- The stop made the day it was paid is this plan's first morning, not a day gone by
    update public.panel_records
       set data = data || jsonb_build_object('date', today_key)
     where module = 'deliveries' and data ->> 'orderNumber' = '#' || plan.order_number
       and data ->> 'date' = to_char((plan.placed_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') and data ->> 'status' in ('Pending', 'Out for delivery');
    continue when exists (
      select 1 from public.panel_records d
       where d.module = 'deliveries' and d.data ->> 'orderNumber' = '#' || plan.order_number and d.data ->> 'date' = today_key);

    new_id := 'D-' || replace(today_key, '-', '') || '-' || plan.order_number;
    insert into public.panel_records (module, id, data, owner_mobile)
    values ('deliveries', new_id,
            (last_stop.data - 'history' - 'transferRequest' - 'deliveredAt' - 'proof')
              || jsonb_build_object('id', new_id, 'date', today_key, 'status', 'Pending', 'isSubscription', true,
                                    'items', private.one_day_items(last_stop.data -> 'items', plan.subscription)),
            last_stop.owner_mobile)
    on conflict do nothing;
    if found then
      added := added + 1;
    end if;
  end loop;
  -- Each morning: the plans' share of stock follows who is delivered today (new plans in, paused plans out)
  perform private.refresh_all_plan_shares();
  return added;
end;
$function$;
