-- Allow photo processing outputs to be explicit preview candidates until accepted.
-- Preview representations can be shown in the monitor, but are not applied to
-- item_images until the user accepts them.

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'photo_capture_representations_status_check'
      and conrelid = 'public.photo_capture_representations'::regclass
  ) then
    alter table public.photo_capture_representations
      drop constraint photo_capture_representations_status_check;
  end if;
end $$;

alter table public.photo_capture_representations
  add constraint photo_capture_representations_status_check
  check (status in (
    'available',
    'preview',
    'accepted',
    'pending',
    'processing',
    'failed',
    'deleted',
    'archived'
  ));
