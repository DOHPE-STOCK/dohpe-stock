-- Normalise item stock locations using Settings > Locations.
-- Resolves either public.locations.name or public.locations.label to public.locations.name.
-- No temp tables, so this runs cleanly in the Supabase SQL editor.

begin;

with active_locations as (
  select
    name,
    label,
    upper(regexp_replace(trim(name), '[[:space:]_]+', '-', 'g')) as name_key,
    upper(regexp_replace(trim(coalesce(label, '')), '[[:space:]_]+', '-', 'g')) as label_key
  from public.locations
  where coalesce(is_active, true)
),
resolved as (
  select
    isl.item_id,
    upper(trim(coalesce(isl.sku, i.sku))) as sku,
    coalesce(
      (
        select al.name
        from active_locations al
        where upper(regexp_replace(trim(coalesce(isl.location_name, '')), '[[:space:]_]+', '-', 'g')) in (al.name_key, al.label_key)
        limit 1
      ),
      nullif(trim(isl.location_name), ''),
      nullif(trim(i.current_location), ''),
      'LOCATION-1'
    ) as location_name,
    coalesce(nullif(trim(isl.bin_code), ''), 'Default') as bin_code,
    greatest(0, coalesce(isl.stock_level, 0))::integer as stock_level,
    coalesce(isl.source, 'location_cleanup') as source,
    isl.synced_at
  from public.item_stock_locations isl
  left join public.items i
    on i.id = isl.item_id
),
deduped as (
  select
    item_id,
    sku,
    location_name,
    min(bin_code) as bin_code,
    max(stock_level)::integer as stock_level,
    max(source) as source,
    max(synced_at) as synced_at
  from resolved
  where sku is not null and sku <> ''
  group by item_id, sku, location_name, upper(bin_code)
),
deleted_rows as (
  delete from public.item_stock_locations
  returning 1
),
delete_done as (
  select count(*) as deleted_count from deleted_rows
),
inserted_rows as (
  insert into public.item_stock_locations (
    item_id,
    sku,
    location_name,
    location_id,
    bin_code,
    stock_level,
    source,
    synced_at,
    updated_at
  )
  select
    d.item_id,
    d.sku,
    d.location_name,
    null,
    d.bin_code,
    d.stock_level,
    d.source,
    d.synced_at,
    now()
  from deduped d
  cross join delete_done
  where d.stock_level > 0
  returning item_id, stock_level, location_name, bin_code
),
item_totals as (
  select
    item_id,
    sum(stock_level)::integer as total_stock,
    max(location_name) filter (where stock_level > 0) as any_location,
    max(bin_code) filter (where stock_level > 0) as any_bin
  from inserted_rows
  where item_id is not null
  group by item_id
)
update public.items i
set
  stock_level = item_totals.total_stock,
  current_location = coalesce(item_totals.any_location, i.current_location),
  current_bin = coalesce(item_totals.any_bin, i.current_bin),
  updated_at = now()
from item_totals
where i.id = item_totals.item_id;

commit;
