-- Required for stock-location upserts used by item save and receiving.
-- Fixes:
--   there is no unique or exclusion constraint matching the ON CONFLICT specification
--
-- Safe intent:
-- - Backfills missing company_id on stock-location rows from the parent item.
-- - Normalises blank bin_code to Default.
-- - Merges exact duplicate rows for the same company/item/location/bin by summing stock_level.
-- - Adds the company-scoped unique index required by:
--     onConflict: company_id,item_id,location_name,bin_code

begin;

update public.item_stock_locations isl
set company_id = i.company_id
from public.items i
where isl.item_id = i.id
  and isl.company_id is null
  and i.company_id is not null;

update public.item_stock_locations
set bin_code = 'Default'
where bin_code is null
   or trim(bin_code) = '';

with duplicate_groups as (
  select
    company_id,
    item_id,
    location_name,
    bin_code,
    (array_agg(id order by created_at nulls last, id::text))[1] as keep_id,
    sum(coalesce(stock_level, 0)) as merged_stock_level,
    count(*) as row_count
  from public.item_stock_locations
  where company_id is not null
    and item_id is not null
    and location_name is not null
    and bin_code is not null
  group by company_id, item_id, location_name, bin_code
  having count(*) > 1
),
updated_keep_rows as (
  update public.item_stock_locations isl
  set
    stock_level = dg.merged_stock_level,
    source = 'unique_company_bin_duplicate_merge',
    updated_at = now()
  from duplicate_groups dg
  where isl.id = dg.keep_id
  returning isl.id
)
delete from public.item_stock_locations isl
using duplicate_groups dg
where isl.company_id = dg.company_id
  and isl.item_id = dg.item_id
  and isl.location_name = dg.location_name
  and isl.bin_code = dg.bin_code
  and isl.id <> dg.keep_id;

create unique index if not exists item_stock_locations_unique_company_item_location_bin
on public.item_stock_locations (company_id, item_id, location_name, bin_code);

select
  'item_stock_locations_unique_company_item_location_bin' as check_name,
  count(*) as duplicate_group_count
from (
  select company_id, item_id, location_name, bin_code
  from public.item_stock_locations
  where company_id is not null
    and item_id is not null
    and location_name is not null
    and bin_code is not null
  group by company_id, item_id, location_name, bin_code
  having count(*) > 1
) duplicates;

commit;
