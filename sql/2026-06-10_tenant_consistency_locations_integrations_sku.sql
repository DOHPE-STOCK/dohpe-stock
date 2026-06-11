-- Tenant consistency pass:
-- - Seed missing default locations for companies.
-- - Seed disabled integration placeholder rows for companies.
-- - Move SKU uniqueness to company scope.
-- - Keep RFID/TID identifiers globally unique while allowing SKU/barcode
--   identifier values to repeat in different companies.
--
-- This does not change stock quantities, transfer logic, POS logic, queue
-- processing logic, or Linnworks sync logic.

begin;

-- Old single-tenant location uniqueness blocks LOCATION-1 etc. from existing
-- in more than one company. Replace it with company-scoped uniqueness.
alter table public.locations
drop constraint if exists locations_code_key;

alter table public.locations
drop constraint if exists locations_name_key;

drop index if exists public.locations_code_key;
drop index if exists public.locations_name_key;

create unique index if not exists locations_company_code_unique_idx
on public.locations (company_id, code)
where code is not null;

create unique index if not exists locations_company_name_unique_idx
on public.locations (company_id, name)
where name is not null;

-- Locations: new companies start with five stable internal location slots.
with location_seed(location_name, label, bin_mode, basic_bins, is_active) as (
  values
    ('LOCATION-1', 'Default', 'range', array['Default']::text[], true),
    ('LOCATION-2', 'Default', 'basic', array['FLOOR', 'STOCK']::text[], true),
    ('LOCATION-3', 'Default', 'basic', array['FLOOR', 'STOCK']::text[], true),
    ('LOCATION-4', 'Default', 'basic', array['FLOOR', 'STOCK']::text[], true),
    ('LOCATION-5', 'Default', 'basic', array['FLOOR', 'STOCK']::text[], true)
)
insert into public.locations (
  company_id,
  code,
  name,
  label,
  bin_mode,
  basic_bins,
  is_active
)
select
  c.id,
  ls.location_name,
  ls.location_name,
  ls.label,
  ls.bin_mode,
  ls.basic_bins,
  ls.is_active
from public.companies c
cross join location_seed ls
where not exists (
  select 1
  from public.locations existing
  where existing.company_id = c.id
    and existing.name = ls.location_name
);

-- Integration placeholders: all companies can configure the same channels,
-- but each company has its own connection/settings row.
with channel_seed(channel) as (
  values
    ('linnworks'),
    ('ebay'),
    ('shopify'),
    ('vinted'),
    ('grailed'),
    ('vestiaire_collective'),
    ('whatnot'),
    ('square'),
    ('depop'),
    ('tiktok_shop')
)
insert into public.integration_settings (
  company_id,
  channel,
  enabled,
  auto_sync,
  connection_status,
  settings
)
select
  c.id,
  cs.channel,
  false,
  false,
  'not_configured',
  '{}'::jsonb
from public.companies c
cross join channel_seed cs
where not exists (
  select 1
  from public.integration_settings existing
  where existing.company_id = c.id
    and existing.channel = cs.channel
);

-- Drop old global SKU uniqueness/indexes on items. We only drop unique indexes
-- whose indexed column list includes sku, then replace them with company scope.
do $$
declare
  index_record record;
  constraint_record record;
begin
  for constraint_record in
    select con.conname as constraint_name
    from pg_constraint con
    join pg_class tbl on tbl.oid = con.conrelid
    join pg_namespace ns on ns.oid = tbl.relnamespace
    join unnest(con.conkey) as key(attnum) on true
    join pg_attribute att on att.attrelid = tbl.oid and att.attnum = key.attnum
    where ns.nspname = 'public'
      and tbl.relname = 'items'
      and con.contype = 'u'
      and att.attname = 'sku'
  loop
    execute format(
      'alter table public.items drop constraint if exists %I',
      constraint_record.constraint_name
    );
  end loop;

  for index_record in
    select
      ns.nspname as schema_name,
      idx.relname as index_name
    from pg_index ix
    join pg_class tbl on tbl.oid = ix.indrelid
    join pg_namespace ns on ns.oid = tbl.relnamespace
    join pg_class idx on idx.oid = ix.indexrelid
    join pg_attribute att on att.attrelid = tbl.oid and att.attnum = any(ix.indkey)
    where ns.nspname = 'public'
      and tbl.relname = 'items'
      and ix.indisunique
      and att.attname = 'sku'
  loop
    execute format('drop index if exists %I.%I', index_record.schema_name, index_record.index_name);
  end loop;
end $$;

create unique index if not exists items_company_sku_unique_idx
on public.items (company_id, upper(trim(sku)))
where sku is not null and trim(sku) <> '';

-- generated_skus used to have sku as the primary key. Make generated SKU
-- history company-scoped so the same SKU can exist in another tenant.
alter table public.generated_skus
drop constraint if exists generated_skus_pkey;

create unique index if not exists generated_skus_company_sku_unique_idx
on public.generated_skus (company_id, sku);

-- Identifier lookup:
-- - RFID values remain globally unique while active.
-- - SKU/barcode/external values are unique per company while active.
drop index if exists public.item_identifiers_active_value_unique;

create unique index if not exists item_identifiers_active_rfid_value_unique
on public.item_identifiers (identifier_value_normalized)
where is_active is true
  and identifier_type = 'rfid';

create unique index if not exists item_identifiers_company_active_value_unique
on public.item_identifiers (company_id, identifier_type, identifier_value_normalized)
where is_active is true
  and identifier_type <> 'rfid';

create index if not exists item_identifiers_company_type_value_idx
on public.item_identifiers (company_id, identifier_type, identifier_value_normalized);

-- Quick result summary.
select
  'locations' as check_group,
  c.slug,
  count(l.id) as row_count
from public.companies c
left join public.locations l on l.company_id = c.id
where c.slug in ('dohpe', 'dl-retail')
group by c.slug
order by c.slug;

select
  'integrations' as check_group,
  c.slug,
  count(i.id) as row_count
from public.companies c
left join public.integration_settings i on i.company_id = c.id
where c.slug in ('dohpe', 'dl-retail')
group by c.slug
order by c.slug;

commit;
