-- Extend the photography architecture with explicit background-removal jobs
-- and Calibrite/colour-checker calibration profiles.

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'photo_processing_jobs_type_check'
  ) then
    alter table public.photo_processing_jobs
      drop constraint photo_processing_jobs_type_check;
  end if;

  alter table public.photo_processing_jobs
    add constraint photo_processing_jobs_type_check
    check (job_type in (
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
  ) then
    alter table public.photo_capture_representations
      drop constraint photo_capture_representations_type_check;
  end if;

  alter table public.photo_capture_representations
    add constraint photo_capture_representations_type_check
    check (representation_type in (
      'camera_original_jpeg',
      'raw_original',
      'calibrated_preview',
      'measurement_analysis',
      'processed_preview',
      'product_master',
      'background_removed',
      'derivative',
      'thumbnail'
    ));

  if exists (
    select 1
    from pg_constraint
    where conname = 'photography_calibration_profiles_type_check'
  ) then
    alter table public.photography_calibration_profiles
      drop constraint photography_calibration_profiles_type_check;
  end if;

  alter table public.photography_calibration_profiles
    add constraint photography_calibration_profiles_type_check
    check (profile_type in (
      'colour_white_balance',
      'calibrite_colour_checker',
      'geometry_scale',
      'lens_geometry'
    ));
end $$;
