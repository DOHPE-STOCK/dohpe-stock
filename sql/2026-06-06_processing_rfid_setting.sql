-- Processing workflow settings.
-- RFID receiving controls only the Processing > Receiving table workflow.
-- RFID identifiers remain searchable/scannable elsewhere even when this is false.

alter table public.app_settings
add column if not exists enable_rfid_receiving boolean not null default false;
