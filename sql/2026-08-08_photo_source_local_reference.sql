alter table public.photo_sources
  add column if not exists local_reference jsonb not null default '{}'::jsonb;

