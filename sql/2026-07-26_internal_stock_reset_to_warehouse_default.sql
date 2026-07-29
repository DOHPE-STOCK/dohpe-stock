-- Optional internal-company cleanup.
--
-- This consolidates all positive stock rows for the internal companies into
-- LOCATION-1 / Default and removes the old per-location/bin rows for those
-- items. It is intended only for David's current internal test/live companies
-- before the cleaner stock model migration.
--
-- It does not touch POS sale history, Linnworks processed sale history,
-- transfer history, movement logs, or item images.

begin;

create temp table _internal_stock_reset_items as
select
  i.company_id,
  i.id as item_id,
  i.sku,
  greatest(
    0,
    coalesce(sum(coalesce(isl.stock_level, 0)), 0)
  ) as warehouse_default_stock
from public.items i
join public.companies c
  on c.id = i.company_id
left join public.item_stock_locations isl
  on isl.company_id = i.company_id
 and isl.item_id = i.id
where c.slug in ('dohpe', 'dl-retail', 'parapeak')
group by i.company_id, i.id, i.sku;

delete from public.item_stock_locations isl
using _internal_stock_reset_items target
where isl.company_id = target.company_id
  and isl.item_id = target.item_id;

insert into public.item_stock_locations (
  company_id,
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
  target.company_id,
  target.item_id,
  target.sku,
  'LOCATION-1',
  null,
  'Default',
  target.warehouse_default_stock,
  'internal_stock_reset_to_warehouse_default',
  null::timestamp with time zone,
  now()
from _internal_stock_reset_items target
where target.sku is not null
  and trim(target.sku) <> ''
on conflict (company_id, item_id, location_name, bin_code) do update
set
  sku = excluded.sku,
  stock_level = excluded.stock_level,
  source = excluded.source,
  synced_at = excluded.synced_at,
  updated_at = excluded.updated_at;

update public.items i
set
  stock_level = target.warehouse_default_stock,
  warehouse_stock = target.warehouse_default_stock,
  shop_floor_stock = 0,
  current_location = 'LOCATION-1',
  current_bin = 'Default',
  location_status = coalesce(nullif(i.location_status, ''), 'stored'),
  updated_at = now()
from _internal_stock_reset_items target
where i.company_id = target.company_id
  and i.id = target.item_id;

select
  c.slug,
  count(*) as item_count,
  sum(target.warehouse_default_stock) as total_stock_after_reset
from _internal_stock_reset_items target
join public.companies c on c.id = target.company_id
group by c.slug
order by c.slug;

commit;
