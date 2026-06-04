-- Move live stock from legacy display locations into stable LOCATION-* slots.
-- This keeps legacy rows readable, but current/live stock should resolve to slots.

with location_map(legacy_name, slot_name) as (
  values
    ('WAREHOUSE', 'LOCATION-1'),
    ('DEFAULT', 'LOCATION-1'),
    ('SHOP-1', 'LOCATION-2'),
    ('SHOP-2', 'LOCATION-3'),
    ('SHOP-3', 'LOCATION-4'),
    ('SHOP-4', 'LOCATION-5')
)
update public.items i
set
  current_location = m.slot_name,
  updated_at = now()
from location_map m
where upper(i.current_location) = m.legacy_name;

with location_map(legacy_name, slot_name) as (
  values
    ('WAREHOUSE', 'LOCATION-1'),
    ('DEFAULT', 'LOCATION-1'),
    ('SHOP-1', 'LOCATION-2'),
    ('SHOP-2', 'LOCATION-3'),
    ('SHOP-3', 'LOCATION-4'),
    ('SHOP-4', 'LOCATION-5')
),
missing_bins as (
  select
    m.slot_name,
    wb.bin_code,
    max(wb.label) as label,
    bool_or(coalesce(wb.is_active, true)) as is_active
  from public.warehouse_bins wb
  join location_map m on upper(wb.location_name) = m.legacy_name
  group by m.slot_name, wb.bin_code
)
insert into public.warehouse_bins (location_name, bin_code, label, is_active)
select mb.slot_name, mb.bin_code, coalesce(mb.label, mb.bin_code), mb.is_active
from missing_bins mb
where not exists (
  select 1
  from public.warehouse_bins existing
  where existing.location_name = mb.slot_name
    and existing.bin_code = mb.bin_code
);

with location_map(legacy_name, slot_name) as (
  values
    ('WAREHOUSE', 'LOCATION-1'),
    ('DEFAULT', 'LOCATION-1'),
    ('SHOP-1', 'LOCATION-2'),
    ('SHOP-2', 'LOCATION-3'),
    ('SHOP-3', 'LOCATION-4'),
    ('SHOP-4', 'LOCATION-5')
),
conflicts as (
  select
    legacy.id as legacy_id,
    target.id as target_id,
    legacy.stock_level as legacy_stock,
    target.stock_level as target_stock
  from public.item_stock_locations legacy
  join location_map m on upper(legacy.location_name) = m.legacy_name
  join public.item_stock_locations target
    on target.item_id = legacy.item_id
    and target.location_name = m.slot_name
    and target.bin_code = legacy.bin_code
)
update public.item_stock_locations target
set
  stock_level = coalesce(conflicts.target_stock, 0) + coalesce(conflicts.legacy_stock, 0),
  source = 'location_slot_migration',
  updated_at = now()
from conflicts
where target.id = conflicts.target_id;

with location_map(legacy_name, slot_name) as (
  values
    ('WAREHOUSE', 'LOCATION-1'),
    ('DEFAULT', 'LOCATION-1'),
    ('SHOP-1', 'LOCATION-2'),
    ('SHOP-2', 'LOCATION-3'),
    ('SHOP-3', 'LOCATION-4'),
    ('SHOP-4', 'LOCATION-5')
),
conflicts as (
  select legacy.id as legacy_id
  from public.item_stock_locations legacy
  join location_map m on upper(legacy.location_name) = m.legacy_name
  join public.item_stock_locations target
    on target.item_id = legacy.item_id
    and target.location_name = m.slot_name
    and target.bin_code = legacy.bin_code
)
update public.item_stock_locations legacy
set
  stock_level = 0,
  source = 'location_slot_migration_legacy_zeroed',
  updated_at = now()
from conflicts
where legacy.id = conflicts.legacy_id;

with location_map(legacy_name, slot_name) as (
  values
    ('WAREHOUSE', 'LOCATION-1'),
    ('DEFAULT', 'LOCATION-1'),
    ('SHOP-1', 'LOCATION-2'),
    ('SHOP-2', 'LOCATION-3'),
    ('SHOP-3', 'LOCATION-4'),
    ('SHOP-4', 'LOCATION-5')
)
update public.item_stock_locations isl
set
  location_name = m.slot_name,
  source = 'location_slot_migration',
  updated_at = now()
from location_map m
where upper(isl.location_name) = m.legacy_name
  and not exists (
    select 1
    from public.item_stock_locations existing
    where existing.item_id = isl.item_id
      and existing.location_name = m.slot_name
      and existing.bin_code = isl.bin_code
  );

update public.integration_settings
set
  settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
    'location_mapping',
    jsonb_build_object(
      'LOCATION-1', 'Default',
      'LOCATION-2', 'SHOP-1',
      'LOCATION-3', 'SHOP-2',
      'LOCATION-4', 'SHOP-3',
      'LOCATION-5', 'SHOP-4',
      'WAREHOUSE', 'Default'
    )
  ),
  updated_at = now()
where channel = 'linnworks';
