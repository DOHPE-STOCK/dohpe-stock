-- Normalise legacy location values into stable LOCATION-* codes.
-- Safe to run more than once. Duplicate stock rows are merged into one live row
-- and the old duplicate rows are left at stock_level 0 for audit safety.

with location_map(legacy_name, slot_name) as (
  values
    ('WAREHOUSE', 'LOCATION-1'),
    ('DEFAULT', 'LOCATION-1'),
    ('LOCATION 1', 'LOCATION-1'),
    ('LOCATION_1', 'LOCATION-1'),
    ('SHOP-1', 'LOCATION-2'),
    ('SHOP 1', 'LOCATION-2'),
    ('SHOP_1', 'LOCATION-2'),
    ('LOCATION 2', 'LOCATION-2'),
    ('LOCATION_2', 'LOCATION-2'),
    ('SHOP-2', 'LOCATION-3'),
    ('SHOP 2', 'LOCATION-3'),
    ('SHOP_2', 'LOCATION-3'),
    ('LOCATION 3', 'LOCATION-3'),
    ('LOCATION_3', 'LOCATION-3'),
    ('SHOP-3', 'LOCATION-4'),
    ('SHOP 3', 'LOCATION-4'),
    ('SHOP_3', 'LOCATION-4'),
    ('LOCATION 4', 'LOCATION-4'),
    ('LOCATION_4', 'LOCATION-4'),
    ('SHOP-4', 'LOCATION-5'),
    ('SHOP 4', 'LOCATION-5'),
    ('SHOP_4', 'LOCATION-5'),
    ('LOCATION 5', 'LOCATION-5'),
    ('LOCATION_5', 'LOCATION-5')
)
update public.items i
set
  current_location = m.slot_name,
  current_bin = case
    when i.current_bin is null or btrim(i.current_bin) = '' then 'Default'
    when upper(btrim(i.current_bin)) = 'DEFAULT' then 'Default'
    else btrim(i.current_bin)
  end,
  updated_at = now()
from location_map m
where upper(btrim(coalesce(i.current_location, ''))) = m.legacy_name;

update public.items
set
  current_location = coalesce(nullif(btrim(current_location), ''), 'LOCATION-1'),
  current_bin = case
    when current_bin is null or btrim(current_bin) = '' then 'Default'
    when upper(btrim(current_bin)) = 'DEFAULT' then 'Default'
    else btrim(current_bin)
  end,
  location_status = coalesce(nullif(btrim(location_status), ''), 'stored'),
  updated_at = now()
where
  current_location is null
  or btrim(current_location) = ''
  or current_bin is null
  or btrim(current_bin) = ''
  or location_status is null
  or btrim(location_status) = '';

with location_map(legacy_name, slot_name) as (
  values
    ('WAREHOUSE', 'LOCATION-1'),
    ('DEFAULT', 'LOCATION-1'),
    ('LOCATION 1', 'LOCATION-1'),
    ('LOCATION_1', 'LOCATION-1'),
    ('SHOP-1', 'LOCATION-2'),
    ('SHOP 1', 'LOCATION-2'),
    ('SHOP_1', 'LOCATION-2'),
    ('LOCATION 2', 'LOCATION-2'),
    ('LOCATION_2', 'LOCATION-2'),
    ('SHOP-2', 'LOCATION-3'),
    ('SHOP 2', 'LOCATION-3'),
    ('SHOP_2', 'LOCATION-3'),
    ('LOCATION 3', 'LOCATION-3'),
    ('LOCATION_3', 'LOCATION-3'),
    ('SHOP-3', 'LOCATION-4'),
    ('SHOP 3', 'LOCATION-4'),
    ('SHOP_3', 'LOCATION-4'),
    ('LOCATION 4', 'LOCATION-4'),
    ('LOCATION_4', 'LOCATION-4'),
    ('SHOP-4', 'LOCATION-5'),
    ('SHOP 4', 'LOCATION-5'),
    ('SHOP_4', 'LOCATION-5'),
    ('LOCATION 5', 'LOCATION-5'),
    ('LOCATION_5', 'LOCATION-5')
)
update public.item_stock_locations isl
set
  location_name = m.slot_name,
  bin_code = case
    when isl.bin_code is null or btrim(isl.bin_code) = '' then 'Default'
    when upper(btrim(isl.bin_code)) = 'DEFAULT' then 'Default'
    else btrim(isl.bin_code)
  end,
  source = coalesce(nullif(source, ''), 'legacy_location_normalised'),
  updated_at = now()
from location_map m
where upper(btrim(coalesce(isl.location_name, ''))) = m.legacy_name;

update public.item_stock_locations
set
  location_name = coalesce(nullif(btrim(location_name), ''), 'LOCATION-1'),
  bin_code = case
    when bin_code is null or btrim(bin_code) = '' then 'Default'
    when upper(btrim(bin_code)) = 'DEFAULT' then 'Default'
    else btrim(bin_code)
  end,
  updated_at = now()
where
  location_name is null
  or btrim(location_name) = ''
  or bin_code is null
  or btrim(bin_code) = '';

with ranked as (
  select
    id,
    sum(coalesce(stock_level, 0)) over (
      partition by
        coalesce(item_id::text, 'sku:' || upper(coalesce(sku, ''))),
        location_name,
        bin_code
    ) as merged_stock,
    row_number() over (
      partition by
        coalesce(item_id::text, 'sku:' || upper(coalesce(sku, ''))),
        location_name,
        bin_code
      order by coalesce(stock_level, 0) desc, updated_at desc nulls last, id::text
    ) as row_rank
  from public.item_stock_locations
)
update public.item_stock_locations isl
set
  stock_level = case when ranked.row_rank = 1 then ranked.merged_stock else 0 end,
  source = case
    when ranked.row_rank = 1 then 'legacy_location_merged'
    else 'legacy_location_duplicate_zeroed'
  end,
  updated_at = now()
from ranked
where isl.id = ranked.id
  and (
    ranked.row_rank > 1
    or coalesce(isl.stock_level, 0) <> ranked.merged_stock
  );

with location_map(legacy_name, slot_name) as (
  values
    ('WAREHOUSE', 'LOCATION-1'),
    ('DEFAULT', 'LOCATION-1'),
    ('SHOP-1', 'LOCATION-2'),
    ('SHOP-2', 'LOCATION-3'),
    ('SHOP-3', 'LOCATION-4'),
    ('SHOP-4', 'LOCATION-5')
)
update public.warehouse_bins wb
set
  location_name = m.slot_name,
  bin_code = case
    when wb.bin_code is null or btrim(wb.bin_code) = '' then 'Default'
    when upper(btrim(wb.bin_code)) = 'DEFAULT' then 'Default'
    else btrim(wb.bin_code)
  end
from location_map m
where upper(btrim(coalesce(wb.location_name, ''))) = m.legacy_name
  and not exists (
    select 1
    from public.warehouse_bins existing
    where existing.location_name = m.slot_name
      and existing.bin_code = case
        when wb.bin_code is null or btrim(wb.bin_code) = '' then 'Default'
        when upper(btrim(wb.bin_code)) = 'DEFAULT' then 'Default'
        else btrim(wb.bin_code)
      end
  );
