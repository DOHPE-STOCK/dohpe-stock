-- One-shot station capture intents.
-- Used when the next image from a station should be stored as station
-- metadata, such as a calibration reference, instead of an item photo.

create table if not exists public.photo_station_capture_intents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  station_id uuid not null references public.photography_stations(id) on delete cascade,
  source_id uuid null references public.photo_sources(id) on delete set null,
  intent_type text not null,
  status text not null default 'queued',
  requested_by_staff_id uuid null references public.staff_users(id) on delete set null,
  consumed_capture_id uuid null references public.photo_captures(id) on delete set null,
  expires_at timestamp with time zone not null default (now() + interval '10 minutes'),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  consumed_at timestamp with time zone null,

  constraint photo_station_capture_intents_type_check
    check (intent_type in ('station_calibration')),
  constraint photo_station_capture_intents_status_check
    check (status in ('queued', 'consumed', 'cancelled', 'expired'))
);

create unique index if not exists photo_station_capture_intents_one_queued_idx
on public.photo_station_capture_intents (company_id, station_id, intent_type)
where status = 'queued';

create index if not exists photo_station_capture_intents_station_status_idx
on public.photo_station_capture_intents (company_id, station_id, status, expires_at);

drop trigger if exists photo_station_capture_intents_touch_updated_at
on public.photo_station_capture_intents;

create trigger photo_station_capture_intents_touch_updated_at
before update on public.photo_station_capture_intents
for each row
execute function public.touch_updated_at();

alter table public.photo_station_capture_intents enable row level security;

drop policy if exists "loopbase read own company photo station capture intents"
on public.photo_station_capture_intents;

create policy "loopbase read own company photo station capture intents"
on public.photo_station_capture_intents
for select
to authenticated
using (public.loopbase_user_can_read_company(company_id));

drop policy if exists "loopbase manage own company photo station capture intents"
on public.photo_station_capture_intents;

create policy "loopbase manage own company photo station capture intents"
on public.photo_station_capture_intents
for all
to authenticated
using (public.loopbase_user_can_write_company(company_id))
with check (public.loopbase_user_can_write_company(company_id));

do $$
begin
  begin
    alter publication supabase_realtime add table public.photo_station_capture_intents;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;
