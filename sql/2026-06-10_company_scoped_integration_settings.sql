-- Company-scoped integration settings.
-- Run after the multi-tenant foundation migration.
--
-- Purpose:
-- - Existing rows remain assigned to the default DOHPE company by the foundation migration.
-- - Each company can then have its own eBay/Linnworks/etc settings row for the same channel.
-- - This does not delete integration data.

begin;

alter table public.integration_settings
  drop constraint if exists integration_settings_channel_key;

drop index if exists public.integration_settings_channel_key;
drop index if exists public.integration_settings_company_channel_unique;

create unique index integration_settings_company_channel_unique
on public.integration_settings (company_id, channel)
where company_id is not null;

commit;
