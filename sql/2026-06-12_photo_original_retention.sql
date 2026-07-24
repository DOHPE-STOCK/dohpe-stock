-- Photo original retention and upload limit settings.
--
-- Safety rule:
-- Originals are only eligible for cleanup when a saved processed image exists.
-- RAW files remain local/station-side and are not controlled by this table.

create table if not exists public.company_photo_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  original_retention_days integer not null default 14,
  manual_upload_max_file_mb integer not null default 20,
  manual_upload_max_files integer not null default 20,
  station_upload_max_file_mb integer not null default 50,
  cleanup_batch_limit integer not null default 200,
  raw_storage_policy text not null default 'local_only',
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  constraint company_photo_settings_original_retention_check
    check (original_retention_days between 1 and 3650),
  constraint company_photo_settings_manual_file_check
    check (manual_upload_max_file_mb between 1 and 200),
  constraint company_photo_settings_manual_files_check
    check (manual_upload_max_files between 1 and 200),
  constraint company_photo_settings_station_file_check
    check (station_upload_max_file_mb between 1 and 500),
  constraint company_photo_settings_cleanup_batch_check
    check (cleanup_batch_limit between 1 and 2000),
  constraint company_photo_settings_raw_storage_policy_check
    check (raw_storage_policy in ('local_only', 'cloud_archive_opt_in'))
);

insert into public.company_photo_settings (company_id)
select c.id
from public.companies c
where not exists (
  select 1
  from public.company_photo_settings cps
  where cps.company_id = c.id
);

drop trigger if exists company_photo_settings_touch_updated_at on public.company_photo_settings;
create trigger company_photo_settings_touch_updated_at
before update on public.company_photo_settings
for each row execute function public.touch_updated_at();

alter table public.item_images
  add column if not exists original_storage_bucket text null default 'item-images',
  add column if not exists original_storage_path text null,
  add column if not exists original_file_size_bytes bigint null,
  add column if not exists processed_storage_bucket text null default 'item-images',
  add column if not exists processed_storage_path text null,
  add column if not exists processed_file_size_bytes bigint null,
  add column if not exists original_delete_after timestamp with time zone null,
  add column if not exists original_deleted_at timestamp with time zone null,
  add column if not exists original_retention_status text not null default 'active',
  add column if not exists upload_source text null;

alter table public.item_images
drop constraint if exists item_images_original_retention_status_check;

alter table public.item_images
add constraint item_images_original_retention_status_check
check (original_retention_status in ('active', 'cleanup_scheduled', 'deleted', 'delete_failed', 'preserved'));

create index if not exists item_images_original_cleanup_idx
on public.item_images (company_id, original_delete_after)
where original_url is not null
  and processed_url is not null
  and original_deleted_at is null;

create index if not exists item_images_upload_source_idx
on public.item_images (company_id, upload_source);

alter table public.company_photo_settings enable row level security;

drop policy if exists "authenticated read own company photo settings"
on public.company_photo_settings;

create policy "authenticated read own company photo settings"
on public.company_photo_settings
for select
to authenticated
using (
  exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = company_photo_settings.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
  )
);

drop policy if exists "owners manage own company photo settings"
on public.company_photo_settings;

create policy "owners manage own company photo settings"
on public.company_photo_settings
for all
to authenticated
using (
  exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = company_photo_settings.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('owner', 'admin', 'manager')
  )
)
with check (
  exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = company_photo_settings.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('owner', 'admin', 'manager')
  )
);
