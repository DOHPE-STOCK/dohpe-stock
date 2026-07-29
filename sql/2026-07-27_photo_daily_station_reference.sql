-- Allow one station/day reference calibration image to drive colour,
-- geometry/measurement, crop guidance, and background removal.

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'photography_calibration_profiles_type_check'
      and conrelid = 'public.photography_calibration_profiles'::regclass
  ) then
    alter table public.photography_calibration_profiles
      drop constraint photography_calibration_profiles_type_check;
  end if;

  alter table public.photography_calibration_profiles
    add constraint photography_calibration_profiles_type_check
    check (profile_type in (
      'station_daily_reference',
      'colour_white_balance',
      'calibrite_colour_checker',
      'geometry_scale',
      'lens_geometry'
    ));
end $$;

