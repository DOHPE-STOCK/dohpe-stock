-- Photography station/session foundation.
-- Safe first phase: no existing photo/item rows are rewritten.
-- Run in Supabase SQL editor before using Start Photo Session / Photo Monitor.

create table if not exists public.photography_stations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid null references public.locations(id) on delete set null,
  name text not null,
  code text not null,
  description text null,
  status text not null default 'active',
  active_photo_session_id uuid null,
  auto_start_from_rfid boolean not null default false,
  auto_start_from_barcode boolean not null default false,
  created_by uuid null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  last_activity_at timestamp with time zone null,

  constraint photography_stations_status_check
    check (status in ('active', 'disabled', 'archived'))
);

create unique index if not exists photography_stations_company_code_unique
on public.photography_stations (company_id, lower(code));

create index if not exists photography_stations_company_status_idx
on public.photography_stations (company_id, status, name);

create table if not exists public.photo_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  station_id uuid not null references public.photography_stations(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  started_at timestamp with time zone not null default now(),
  ended_at timestamp with time zone null,
  started_by_user_id uuid null,
  started_by_staff_id uuid null references public.staff_users(id) on delete set null,
  start_method text not null default 'manual_button',
  status text not null default 'active',
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  constraint photo_sessions_start_method_check
    check (start_method in ('manual_button', 'barcode_scan', 'rfid_scan', 'api')),
  constraint photo_sessions_status_check
    check (status in ('active', 'ended', 'cancelled'))
);

create unique index if not exists photo_sessions_one_active_per_station_idx
on public.photo_sessions (station_id)
where status = 'active';

create index if not exists photo_sessions_company_station_idx
on public.photo_sessions (company_id, station_id, started_at desc);

create index if not exists photo_sessions_company_item_idx
on public.photo_sessions (company_id, item_id, started_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'photography_stations_active_photo_session_fkey'
  ) then
    alter table public.photography_stations
      add constraint photography_stations_active_photo_session_fkey
      foreign key (active_photo_session_id)
      references public.photo_sessions(id)
      on delete set null;
  end if;
end $$;

create table if not exists public.photo_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  station_id uuid not null references public.photography_stations(id) on delete cascade,
  name text not null,
  source_type text not null default 'manual',
  manufacturer text null,
  camera_model text null,
  enabled boolean not null default true,
  timezone text null default 'Europe/London',
  clock_offset_seconds integer not null default 0,
  capture_tolerance_seconds integer not null default 90,
  source_file_policy text not null default 'keep_source_file',
  token_hash text null,
  token_last_four text null,
  token_created_at timestamp with time zone null,
  token_revoked_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  last_activity_at timestamp with time zone null,

  constraint photo_sources_source_type_check
    check (source_type in ('watched_folder', 'phone', 'manual', 'api')),
  constraint photo_sources_file_policy_check
    check (
      source_file_policy in (
        'keep_source_file',
        'move_to_processed',
        'delete_source_when_product_photo_deleted',
        'move_source_to_trash_when_product_photo_deleted'
      )
    )
);

create unique index if not exists photo_sources_company_station_name_unique
on public.photo_sources (company_id, station_id, lower(name));

create index if not exists photo_sources_company_station_idx
on public.photo_sources (company_id, station_id, enabled);

create table if not exists public.photo_captures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  station_id uuid null references public.photography_stations(id) on delete set null,
  session_id uuid null references public.photo_sessions(id) on delete set null,
  item_id uuid null references public.items(id) on delete set null,
  source_id uuid null references public.photo_sources(id) on delete set null,
  item_image_id uuid null references public.item_images(id) on delete set null,
  capture_status text not null default 'assigned',
  assignment_method text not null default 'manual',
  sha256 text null,
  original_filename text null,
  captured_at timestamp with time zone null,
  received_at timestamp with time zone not null default now(),
  exif jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  constraint photo_captures_status_check
    check (capture_status in ('assigned', 'unassigned', 'deleted', 'archived')),
  constraint photo_captures_assignment_method_check
    check (assignment_method in ('explicit_session', 'capture_time', 'active_session', 'manual', 'unassigned'))
);

create unique index if not exists photo_captures_company_sha256_unique
on public.photo_captures (company_id, sha256)
where sha256 is not null;

create index if not exists photo_captures_company_session_idx
on public.photo_captures (company_id, session_id, received_at desc);

create index if not exists photo_captures_company_item_idx
on public.photo_captures (company_id, item_id, received_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists photography_stations_touch_updated_at on public.photography_stations;
create trigger photography_stations_touch_updated_at
before update on public.photography_stations
for each row execute function public.touch_updated_at();

drop trigger if exists photo_sessions_touch_updated_at on public.photo_sessions;
create trigger photo_sessions_touch_updated_at
before update on public.photo_sessions
for each row execute function public.touch_updated_at();

drop trigger if exists photo_sources_touch_updated_at on public.photo_sources;
create trigger photo_sources_touch_updated_at
before update on public.photo_sources
for each row execute function public.touch_updated_at();

drop trigger if exists photo_captures_touch_updated_at on public.photo_captures;
create trigger photo_captures_touch_updated_at
before update on public.photo_captures
for each row execute function public.touch_updated_at();

create or replace function public.start_photo_session(
  p_company_id uuid,
  p_station_id uuid,
  p_item_id uuid,
  p_start_method text default 'manual_button',
  p_started_by_user_id uuid default null,
  p_started_by_staff_id uuid default null
)
returns public.photo_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  current_session public.photo_sessions;
  next_session public.photo_sessions;
begin
  if p_start_method not in ('manual_button', 'barcode_scan', 'rfid_scan', 'api') then
    raise exception 'Invalid start method: %', p_start_method;
  end if;

  perform 1
  from public.photography_stations ps
  where ps.id = p_station_id
    and ps.company_id = p_company_id
    and ps.status = 'active';

  if not found then
    raise exception 'Photography station is not active for this company.';
  end if;

  perform 1
  from public.items i
  where i.id = p_item_id
    and i.company_id = p_company_id;

  if not found then
    raise exception 'Item is not available for this company.';
  end if;

  select *
  into current_session
  from public.photo_sessions
  where station_id = p_station_id
    and status = 'active'
  order by started_at desc
  limit 1
  for update;

  if current_session.id is not null and current_session.item_id = p_item_id then
    update public.photography_stations
    set active_photo_session_id = current_session.id,
        last_activity_at = now()
    where id = p_station_id;

    return current_session;
  end if;

  if current_session.id is not null then
    update public.photo_sessions
    set status = 'ended',
        ended_at = now()
    where id = current_session.id;
  end if;

  insert into public.photo_sessions (
    company_id,
    station_id,
    item_id,
    start_method,
    started_by_user_id,
    started_by_staff_id
  )
  values (
    p_company_id,
    p_station_id,
    p_item_id,
    p_start_method,
    p_started_by_user_id,
    p_started_by_staff_id
  )
  returning * into next_session;

  update public.photography_stations
  set active_photo_session_id = next_session.id,
      last_activity_at = now()
  where id = p_station_id;

  return next_session;
end;
$$;

create or replace function public.end_photo_session(
  p_company_id uuid,
  p_station_id uuid
)
returns public.photo_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  ended_session public.photo_sessions;
begin
  select *
  into ended_session
  from public.photo_sessions
  where company_id = p_company_id
    and station_id = p_station_id
    and status = 'active'
  order by started_at desc
  limit 1
  for update;

  if ended_session.id is null then
    return null;
  end if;

  update public.photo_sessions
  set status = 'ended',
      ended_at = now()
  where id = ended_session.id
  returning * into ended_session;

  update public.photography_stations
  set active_photo_session_id = null,
      last_activity_at = now()
  where id = p_station_id
    and active_photo_session_id = ended_session.id;

  return ended_session;
end;
$$;

alter table public.photography_stations enable row level security;
alter table public.photo_sessions enable row level security;
alter table public.photo_sources enable row level security;
alter table public.photo_captures enable row level security;

drop policy if exists "loopbase read own company photography stations" on public.photography_stations;
create policy "loopbase read own company photography stations"
on public.photography_stations
for select
to authenticated
using (
  exists (
    select 1 from public.company_memberships cm
    where cm.company_id = photography_stations.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
  )
);

drop policy if exists "loopbase manage own company photography stations" on public.photography_stations;
create policy "loopbase manage own company photography stations"
on public.photography_stations
for all
to authenticated
using (
  exists (
    select 1 from public.company_memberships cm
    where cm.company_id = photography_stations.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('owner', 'admin', 'manager')
  )
)
with check (
  exists (
    select 1 from public.company_memberships cm
    where cm.company_id = photography_stations.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('owner', 'admin', 'manager')
  )
);

drop policy if exists "loopbase read own company photo sessions" on public.photo_sessions;
create policy "loopbase read own company photo sessions"
on public.photo_sessions
for select
to authenticated
using (
  exists (
    select 1 from public.company_memberships cm
    where cm.company_id = photo_sessions.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
  )
);

drop policy if exists "loopbase manage own company photo sessions" on public.photo_sessions;
create policy "loopbase manage own company photo sessions"
on public.photo_sessions
for all
to authenticated
using (
  exists (
    select 1 from public.company_memberships cm
    where cm.company_id = photo_sessions.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role <> 'viewer'
  )
)
with check (
  exists (
    select 1 from public.company_memberships cm
    where cm.company_id = photo_sessions.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role <> 'viewer'
  )
);

drop policy if exists "loopbase read own company photo sources" on public.photo_sources;
create policy "loopbase read own company photo sources"
on public.photo_sources
for select
to authenticated
using (
  exists (
    select 1 from public.company_memberships cm
    where cm.company_id = photo_sources.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
  )
);

drop policy if exists "loopbase manage own company photo sources" on public.photo_sources;
create policy "loopbase manage own company photo sources"
on public.photo_sources
for all
to authenticated
using (
  exists (
    select 1 from public.company_memberships cm
    where cm.company_id = photo_sources.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('owner', 'admin', 'manager')
  )
)
with check (
  exists (
    select 1 from public.company_memberships cm
    where cm.company_id = photo_sources.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('owner', 'admin', 'manager')
  )
);

drop policy if exists "loopbase read own company photo captures" on public.photo_captures;
create policy "loopbase read own company photo captures"
on public.photo_captures
for select
to authenticated
using (
  exists (
    select 1 from public.company_memberships cm
    where cm.company_id = photo_captures.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
  )
);

drop policy if exists "loopbase manage own company photo captures" on public.photo_captures;
create policy "loopbase manage own company photo captures"
on public.photo_captures
for all
to authenticated
using (
  exists (
    select 1 from public.company_memberships cm
    where cm.company_id = photo_captures.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role <> 'viewer'
  )
)
with check (
  exists (
    select 1 from public.company_memberships cm
    where cm.company_id = photo_captures.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role <> 'viewer'
  )
);

insert into public.photography_stations (company_id, name, code, description, status)
select
  c.id,
  'Default Photo Station',
  'PHOTO-1',
  'Default photography station created for the first photo-session workflow.',
  'active'
from public.companies c
where not exists (
  select 1
  from public.photography_stations ps
  where ps.company_id = c.id
);

do $$
begin
  alter publication supabase_realtime add table public.photography_stations;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.photo_sessions;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.photo_captures;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.item_images;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
