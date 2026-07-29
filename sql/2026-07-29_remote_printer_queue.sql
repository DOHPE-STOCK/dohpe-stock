-- Remote printer queue for Loopbase Station Agent.
-- Company users submit jobs in Loopbase; the local Station Agent polls and prints
-- from a PC that has the printer physically installed.

alter table public.company_devices
add column if not exists station_token text null,
add column if not exists station_capabilities jsonb not null default '{}'::jsonb,
add column if not exists station_last_payload jsonb not null default '{}'::jsonb;

create table if not exists public.remote_print_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  device_id uuid null references public.company_devices(id) on delete set null,
  requested_by uuid null references auth.users(id) on delete set null,
  printer_name text not null,
  job_type text not null default 'file_base64',
  document_name text not null default 'Loopbase Print Job',
  filename text null,
  content_base64 text null,
  content_text text null,
  status text not null default 'queued',
  error_message text null,
  attempts integer not null default 0,
  printed_at timestamp with time zone null,
  claimed_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint remote_print_jobs_status_check check (
    status in ('queued', 'claimed', 'printing', 'printed', 'failed', 'cancelled')
  ),
  constraint remote_print_jobs_type_check check (
    job_type in ('zpl', 'raw_text', 'raw_base64', 'file_base64')
  )
);

create index if not exists remote_print_jobs_company_status_idx
on public.remote_print_jobs (company_id, status, created_at);

create index if not exists remote_print_jobs_device_status_idx
on public.remote_print_jobs (device_id, status, created_at);

alter table public.remote_print_jobs enable row level security;

drop policy if exists "loopbase read own company remote print jobs"
on public.remote_print_jobs;

create policy "loopbase read own company remote print jobs"
on public.remote_print_jobs
for select
to authenticated
using (
  exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = remote_print_jobs.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
  )
);

drop policy if exists "loopbase create own company remote print jobs"
on public.remote_print_jobs;

create policy "loopbase create own company remote print jobs"
on public.remote_print_jobs
for insert
to authenticated
with check (
  exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = remote_print_jobs.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
  )
);

drop policy if exists "loopbase manage own company remote print jobs"
on public.remote_print_jobs;

create policy "loopbase manage own company remote print jobs"
on public.remote_print_jobs
for update
to authenticated
using (
  exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = remote_print_jobs.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
  )
)
with check (
  exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = remote_print_jobs.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
  )
);
