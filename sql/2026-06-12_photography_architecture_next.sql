-- Photography architecture next layer.
-- Additive only: no existing item/image rows are rewritten or deleted.
-- This prepares the SaaS photography workflow for logical representations,
-- worker commands, processing jobs, calibration profiles and first-photo
-- measurement suggestions.

alter table public.photo_sessions
  add column if not exists measurement_source_capture_id uuid null,
  add column if not exists measurement_status text not null default 'not_started',
  add column if not exists measurement_started_at timestamp with time zone null,
  add column if not exists measurement_completed_at timestamp with time zone null,
  add column if not exists measurement_stale_at timestamp with time zone null,
  add column if not exists measurement_error text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'photo_sessions_measurement_source_capture_fkey'
  ) then
    alter table public.photo_sessions
      add constraint photo_sessions_measurement_source_capture_fkey
      foreign key (measurement_source_capture_id)
      references public.photo_captures(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'photo_sessions_measurement_status_check'
  ) then
    alter table public.photo_sessions
      add constraint photo_sessions_measurement_status_check
      check (measurement_status in (
        'not_started',
        'source_selected',
        'queued',
        'processing',
        'complete',
        'low_confidence',
        'unavailable',
        'stale',
        'failed',
        'manual_only'
      ));
  end if;
end $$;

create index if not exists photo_sessions_company_measurement_idx
on public.photo_sessions (company_id, measurement_status, started_at desc);

create table if not exists public.photo_capture_representations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  capture_id uuid not null references public.photo_captures(id) on delete cascade,
  item_id uuid null references public.items(id) on delete set null,
  session_id uuid null references public.photo_sessions(id) on delete set null,
  source_id uuid null references public.photo_sources(id) on delete set null,
  representation_type text not null,
  status text not null default 'available',
  storage_bucket text null,
  storage_path text null,
  public_url text null,
  local_reference jsonb not null default '{}'::jsonb,
  sha256 text null,
  mime_type text null,
  file_size_bytes bigint null,
  original_filename text null,
  width integer null,
  height integer null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  constraint photo_capture_representations_type_check
    check (representation_type in (
      'camera_original_jpeg',
      'raw_original',
      'calibrated_preview',
      'measurement_analysis',
      'processed_preview',
      'product_master',
      'derivative',
      'thumbnail'
    )),
  constraint photo_capture_representations_status_check
    check (status in (
      'available',
      'pending',
      'processing',
      'failed',
      'deleted',
      'archived'
    ))
);

create unique index if not exists photo_capture_representations_company_capture_type_sha_idx
on public.photo_capture_representations (company_id, capture_id, representation_type, sha256)
where sha256 is not null;

create index if not exists photo_capture_representations_company_capture_idx
on public.photo_capture_representations (company_id, capture_id, representation_type);

create table if not exists public.photo_worker_commands (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  station_id uuid null references public.photography_stations(id) on delete set null,
  source_id uuid null references public.photo_sources(id) on delete set null,
  capture_id uuid null references public.photo_captures(id) on delete set null,
  representation_id uuid null references public.photo_capture_representations(id) on delete set null,
  command_type text not null,
  status text not null default 'queued',
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  last_error text null,
  queued_at timestamp with time zone not null default now(),
  claimed_at timestamp with time zone null,
  completed_at timestamp with time zone null,
  created_by uuid null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  constraint photo_worker_commands_type_check
    check (command_type in (
      'move_source_to_processed',
      'delete_source_file',
      'move_source_to_trash',
      'archive_raw_original',
      'process_raw',
      'generate_calibrated_preview',
      'generate_processed_preview'
    )),
  constraint photo_worker_commands_status_check
    check (status in ('queued', 'claimed', 'running', 'completed', 'failed', 'cancelled'))
);

create index if not exists photo_worker_commands_company_source_status_idx
on public.photo_worker_commands (company_id, source_id, status, queued_at);

create table if not exists public.photography_calibration_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  station_id uuid null references public.photography_stations(id) on delete cascade,
  source_id uuid null references public.photo_sources(id) on delete cascade,
  name text not null,
  profile_type text not null,
  status text not null default 'active',
  profile_version integer not null default 1,
  manufacturer text null,
  camera_model text null,
  lens_model text null,
  measured_reference jsonb not null default '{}'::jsonb,
  calibration_data jsonb not null default '{}'::jsonb,
  created_by uuid null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  constraint photography_calibration_profiles_type_check
    check (profile_type in ('colour_white_balance', 'geometry_scale', 'lens_geometry')),
  constraint photography_calibration_profiles_status_check
    check (status in ('active', 'disabled', 'archived'))
);

create index if not exists photography_calibration_profiles_company_station_idx
on public.photography_calibration_profiles (company_id, station_id, source_id, profile_type, status);

create table if not exists public.photo_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  station_id uuid null references public.photography_stations(id) on delete set null,
  source_id uuid null references public.photo_sources(id) on delete set null,
  session_id uuid null references public.photo_sessions(id) on delete set null,
  capture_id uuid not null references public.photo_captures(id) on delete cascade,
  job_type text not null,
  status text not null default 'queued',
  processing_source text not null default 'jpeg_camera_original',
  options jsonb not null default '{}'::jsonb,
  calibration_profile_ids uuid[] not null default '{}',
  result_representation_id uuid null references public.photo_capture_representations(id) on delete set null,
  attempts integer not null default 0,
  error_message text null,
  queued_at timestamp with time zone not null default now(),
  started_at timestamp with time zone null,
  completed_at timestamp with time zone null,
  created_by uuid null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  constraint photo_processing_jobs_type_check
    check (job_type in (
      'calibrated_preview',
      'measurement_analysis',
      'processed_preview',
      'product_master',
      'raw_development',
      'derivative'
    )),
  constraint photo_processing_jobs_status_check
    check (status in (
      'queued',
      'waiting_for_worker',
      'processing',
      'uploading',
      'completed',
      'failed',
      'cancelled'
    )),
  constraint photo_processing_jobs_source_check
    check (processing_source in ('jpeg_camera_original', 'raw_local_original'))
);

create index if not exists photo_processing_jobs_company_status_idx
on public.photo_processing_jobs (company_id, status, queued_at);

create table if not exists public.photo_measurement_suggestions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  session_id uuid not null references public.photo_sessions(id) on delete cascade,
  capture_id uuid not null references public.photo_captures(id) on delete cascade,
  station_id uuid null references public.photography_stations(id) on delete set null,
  calibration_profile_ids uuid[] not null default '{}',
  measurement_type text not null,
  raw_value_mm numeric null,
  raw_value_in numeric null,
  transformation_rule text not null default 'none',
  proposed_value_in numeric null,
  rounding_rule text not null default 'nearest_whole_inch',
  confidence numeric null,
  status text not null default 'suggested',
  processing_version text null,
  metadata jsonb not null default '{}'::jsonb,
  accepted_value_in numeric null,
  accepted_by_staff_id uuid null references public.staff_users(id) on delete set null,
  accepted_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  constraint photo_measurement_suggestions_status_check
    check (status in ('suggested', 'accepted', 'edited', 'rejected', 'stale', 'low_confidence', 'unavailable')),
  constraint photo_measurement_suggestions_confidence_check
    check (confidence is null or (confidence >= 0 and confidence <= 1))
);

create index if not exists photo_measurement_suggestions_company_item_idx
on public.photo_measurement_suggestions (company_id, item_id, created_at desc);

create table if not exists public.photo_phone_pairing_tokens (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  station_id uuid not null references public.photography_stations(id) on delete cascade,
  token_hash text not null,
  token_last_four text null,
  status text not null default 'pending',
  expires_at timestamp with time zone not null,
  paired_device_id uuid null references public.company_devices(id) on delete set null,
  created_by uuid null,
  created_at timestamp with time zone not null default now(),
  used_at timestamp with time zone null,

  constraint photo_phone_pairing_tokens_status_check
    check (status in ('pending', 'used', 'expired', 'revoked'))
);

create unique index if not exists photo_phone_pairing_tokens_hash_unique
on public.photo_phone_pairing_tokens (token_hash);

create index if not exists photo_phone_pairing_tokens_company_station_idx
on public.photo_phone_pairing_tokens (company_id, station_id, status, expires_at);

drop trigger if exists photo_capture_representations_touch_updated_at on public.photo_capture_representations;
create trigger photo_capture_representations_touch_updated_at
before update on public.photo_capture_representations
for each row execute function public.touch_updated_at();

drop trigger if exists photo_worker_commands_touch_updated_at on public.photo_worker_commands;
create trigger photo_worker_commands_touch_updated_at
before update on public.photo_worker_commands
for each row execute function public.touch_updated_at();

drop trigger if exists photography_calibration_profiles_touch_updated_at on public.photography_calibration_profiles;
create trigger photography_calibration_profiles_touch_updated_at
before update on public.photography_calibration_profiles
for each row execute function public.touch_updated_at();

drop trigger if exists photo_processing_jobs_touch_updated_at on public.photo_processing_jobs;
create trigger photo_processing_jobs_touch_updated_at
before update on public.photo_processing_jobs
for each row execute function public.touch_updated_at();

drop trigger if exists photo_measurement_suggestions_touch_updated_at on public.photo_measurement_suggestions;
create trigger photo_measurement_suggestions_touch_updated_at
before update on public.photo_measurement_suggestions
for each row execute function public.touch_updated_at();

create or replace function public.try_designate_photo_measurement_source(
  p_company_id uuid,
  p_session_id uuid,
  p_capture_id uuid
)
returns public.photo_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_session public.photo_sessions;
begin
  perform 1
  from public.photo_captures pc
  where pc.id = p_capture_id
    and pc.company_id = p_company_id
    and pc.session_id = p_session_id
    and pc.capture_status = 'assigned'
    and pc.item_id is not null;

  if not found then
    raise exception 'Capture is not an assigned session capture for this company.';
  end if;

  update public.photo_sessions ps
  set measurement_source_capture_id = p_capture_id,
      measurement_status = 'source_selected',
      measurement_started_at = null,
      measurement_completed_at = null,
      measurement_stale_at = null,
      measurement_error = null
  where ps.id = p_session_id
    and ps.company_id = p_company_id
    and ps.measurement_source_capture_id is null
  returning * into updated_session;

  if updated_session.id is not null then
    return updated_session;
  end if;

  select *
  into updated_session
  from public.photo_sessions
  where id = p_session_id
    and company_id = p_company_id;

  return updated_session;
end;
$$;

create or replace function public.mark_photo_measurement_source_stale(
  p_company_id uuid,
  p_capture_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.photo_sessions
  set measurement_status = 'stale',
      measurement_stale_at = now()
  where company_id = p_company_id
    and measurement_source_capture_id = p_capture_id;

  update public.photo_measurement_suggestions
  set status = 'stale'
  where company_id = p_company_id
    and capture_id = p_capture_id
    and status in ('suggested', 'low_confidence', 'unavailable');
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'photo_capture_representations',
    'photo_worker_commands',
    'photography_calibration_profiles',
    'photo_processing_jobs',
    'photo_measurement_suggestions',
    'photo_phone_pairing_tokens'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);

    execute format('drop policy if exists "loopbase read own company %s" on public.%I', table_name, table_name);
    execute format(
      'create policy "loopbase read own company %s" on public.%I
       for select to authenticated
       using (
         exists (
           select 1 from public.company_memberships cm
           where cm.company_id = %I.company_id
             and cm.user_id = auth.uid()
             and cm.status = ''active''
         )
       )',
      table_name,
      table_name,
      table_name
    );

    execute format('drop policy if exists "loopbase manage own company %s" on public.%I', table_name, table_name);
    execute format(
      'create policy "loopbase manage own company %s" on public.%I
       for all to authenticated
       using (
         exists (
           select 1 from public.company_memberships cm
           where cm.company_id = %I.company_id
             and cm.user_id = auth.uid()
             and cm.status = ''active''
             and cm.role in (''owner'', ''admin'', ''manager'', ''member'')
         )
       )
       with check (
         exists (
           select 1 from public.company_memberships cm
           where cm.company_id = %I.company_id
             and cm.user_id = auth.uid()
             and cm.status = ''active''
             and cm.role in (''owner'', ''admin'', ''manager'', ''member'')
         )
       )',
      table_name,
      table_name,
      table_name,
      table_name
    );
  end loop;
end $$;

do $$
begin
  begin
    alter publication supabase_realtime add table public.photo_capture_representations;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.photo_processing_jobs;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.photo_measurement_suggestions;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;
