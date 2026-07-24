-- Permanent no-edit processed copy for photography captures.
-- This is the safe revert/fallback image that allows true camera originals
-- to be removed later under the retention policy.

alter table public.item_images
  add column if not exists baseline_processed_url text,
  add column if not exists baseline_processed_storage_bucket text default 'item-images',
  add column if not exists baseline_processed_storage_path text,
  add column if not exists baseline_processed_file_size_bytes bigint,
  add column if not exists baseline_processed_created_at timestamp with time zone;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'photo_processing_jobs_type_check'
      and conrelid = 'public.photo_processing_jobs'::regclass
  ) then
    alter table public.photo_processing_jobs
      drop constraint photo_processing_jobs_type_check;
  end if;

  alter table public.photo_processing_jobs
    add constraint photo_processing_jobs_type_check
    check (job_type in (
      'baseline_processed',
      'calibrated_preview',
      'measurement_analysis',
      'processed_preview',
      'product_master',
      'raw_development',
      'background_removal',
      'derivative'
    ));

  if exists (
    select 1
    from pg_constraint
    where conname = 'photo_capture_representations_type_check'
      and conrelid = 'public.photo_capture_representations'::regclass
  ) then
    alter table public.photo_capture_representations
      drop constraint photo_capture_representations_type_check;
  end if;

  alter table public.photo_capture_representations
    add constraint photo_capture_representations_type_check
    check (representation_type in (
      'camera_original_jpeg',
      'raw_original',
      'baseline_processed',
      'calibrated_preview',
      'measurement_analysis',
      'processed_preview',
      'product_master',
      'background_removed',
      'derivative',
      'thumbnail'
    ));
end $$;

create index if not exists item_images_company_baseline_processed_idx
on public.item_images (company_id, baseline_processed_created_at desc)
where baseline_processed_url is not null;
