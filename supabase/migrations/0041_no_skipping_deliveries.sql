-- =====================================================================================================
-- 0041 · No skipping a delivery
--   Customers can no longer skip a day of a milk plan; only a pause remains (8 days or more, as in 0034).
--   guard_pause_request() now refuses a new skip from anyone. Old skip requests stay in panel_records, untouched;
--   the website no longer shows or counts them. None was ever approved, so no plan's dates change.
--   No new table.
-- Safe to run again.
-- =====================================================================================================

create or replace function public.guard_pause_request()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  first_day date;
begin
  if new.module <> 'pause-requests' or current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if new.data ->> 'kind' = 'skip' then
    raise exception 'Skipping a delivery is not available. You can pause your subscription for 8 days or more';
  end if;
  if new.module = any(public.my_panel_modules('create')) then
    return new;
  end if;
  first_day := ((new.data ->> 'pauseFrom')::timestamptz at time zone 'Asia/Kolkata')::date;
  if ((new.data ->> 'resumeOn')::timestamptz at time zone 'Asia/Kolkata')::date - first_day < 8 then
    raise exception 'A pause is for 8 days or more';
  end if;
  return new;
end;
$$;
