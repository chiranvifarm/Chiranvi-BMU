-- =====================================================================================================
-- 0034 · Skip requests, longer pauses, and the plan's end date
--   Skip: a customer asks to skip one delivery in the running week (Monday to Sunday), up to 8 PM the evening
--   before. Pause: for 8 days or more (1.5 weeks, 3 weeks, a month). Both wait for the panel to approve them on
--   the Pause requests page.
--   A skip is a one-day request in the same list (panel_records, "pause-requests"): kind "skip", with its plan
--   in planOrderId (so 0019's pause sync, which reads websiteOrderId, leaves a plan's pause alone).
--   Paid days are not lost: every approved pause and skip adds its days to the plan's order
--   (orders.subscription: pausedDays), so the plan ends later; taken off again if no longer approved.
--   The database checks the rules for customers. "Today" and the 8 PM cut-off are in India's time.
--   No new table.
-- Safe to run again.
-- =====================================================================================================

create or replace function public.guard_pause_request()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  now_in_india timestamp := now() at time zone 'Asia/Kolkata';
  today date := (now() at time zone 'Asia/Kolkata')::date;
  monday date := date_trunc('week', now() at time zone 'Asia/Kolkata')::date;
  first_day date;
  plan_order text := new.data ->> 'planOrderId';
  plan_started date;
begin
  if new.module <> 'pause-requests' or current_user in ('postgres', 'supabase_admin', 'service_role')
     or new.module = any(public.my_panel_modules('create')) then
    return new;
  end if;
  first_day := ((new.data ->> 'pauseFrom')::timestamptz at time zone 'Asia/Kolkata')::date;

  if new.data ->> 'kind' is distinct from 'skip' then
    if ((new.data ->> 'resumeOn')::timestamptz at time zone 'Asia/Kolkata')::date - first_day < 8 then
      raise exception 'A pause is for 8 days or more. For fewer days, skip them in this week''s calendar';
    end if;
    return new;
  end if;

  select (placed_at at time zone 'Asia/Kolkata')::date into plan_started
    from public.orders
   where order_number = plan_order and subscription is not null and status <> 'cancelled'
     and customer_mobile = new.owner_mobile;
  if plan_started is null then
    raise exception 'That plan is not yours' using errcode = '42501';
  end if;
  if first_day < monday or first_day > monday + 6 then
    raise exception 'You can skip days in this week only. For longer, pause your subscription';
  end if;
  -- Up to 8 PM the evening before
  if first_day <= today or (first_day = today + 1 and extract(hour from now_in_india) >= 20) then
    raise exception 'It''s too late to skip this day';
  end if;
  if first_day <= plan_started then
    raise exception 'Your plan starts after this day';
  end if;
  if exists (select 1 from public.panel_records p
              where p.module = 'pause-requests' and p.data ->> 'kind' = 'skip' and p.data ->> 'planOrderId' = plan_order
                and p.data ->> 'status' in ('Pending', 'Approved')
                and ((p.data ->> 'pauseFrom')::timestamptz at time zone 'Asia/Kolkata')::date = first_day) then
    raise exception 'You already asked to skip this day';
  end if;
  return new;
end;
$$;

drop trigger if exists panel_records_guard_pause_request on public.panel_records;
create trigger panel_records_guard_pause_request
  before insert on public.panel_records
  for each row execute function public.guard_pause_request();


-- All of a plan's approved pauses and skips, in days, on its order
create or replace function public.pause_days_to_order()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  plan_order text := coalesce(nullif(new.data ->> 'websiteOrderId', ''), new.data ->> 'planOrderId');
begin
  if new.module <> 'pause-requests' or coalesce(plan_order, '') = ''
     or (old.data ->> 'status') is not distinct from (new.data ->> 'status') then
    return null;
  end if;
  update public.orders
     set subscription = subscription || jsonb_build_object('pausedDays', (
           select coalesce(sum(((p.data ->> 'resumeOn')::timestamptz at time zone 'Asia/Kolkata')::date
                               - ((p.data ->> 'pauseFrom')::timestamptz at time zone 'Asia/Kolkata')::date), 0)
             from public.panel_records p
            where p.module = 'pause-requests' and p.data ->> 'status' = 'Approved'
              and plan_order in (p.data ->> 'websiteOrderId', p.data ->> 'planOrderId')))
   where order_number = plan_order and subscription is not null;
  return null;
end;
$$;

drop trigger if exists panel_records_pause_days_to_order on public.panel_records;
create trigger panel_records_pause_days_to_order
  after update on public.panel_records
  for each row execute function public.pause_days_to_order();

revoke execute on function public.pause_days_to_order() from public, anon, authenticated;
