-- Loopbase Test stock smoke check.
--
-- Run after:
-- 1. sql/2026-07-27_generated_sku_allocator.sql
-- 2. sql/2026-07-27_seed_loopbase_test_company.sql
--
-- This script verifies the test company seed and simulates a stock move.
-- It rolls back at the end, so it does not permanently change stock.

begin;

select
  c.name,
  c.slug,
  c.plan_key,
  c.subscription_status,
  c.billing_exempt,
  c.internal_account,
  count(distinct i.id) as test_item_count,
  coalesce(sum(isl.stock_level), 0) as stock_row_total
from public.companies c
left join public.items i
  on i.company_id = c.id
 and i.sku like 'TEST-%'
left join public.item_stock_locations isl
  on isl.company_id = i.company_id
 and isl.item_id = i.id
where c.slug = 'loopbase-test'
group by
  c.name,
  c.slug,
  c.plan_key,
  c.subscription_status,
  c.billing_exempt,
  c.internal_account;

select
  l.name as internal_location,
  l.label as display_name,
  l.is_retail,
  l.floor_bin_code,
  l.is_default_receiving,
  count(wb.id) filter (where wb.is_active is true) as active_bins
from public.locations l
left join public.warehouse_bins wb
  on wb.company_id = l.company_id
 and wb.location_name = l.name
where l.company_id = (
  select id from public.companies where slug = 'loopbase-test'
)
group by
  l.name,
  l.label,
  l.is_retail,
  l.floor_bin_code,
  l.is_default_receiving
order by l.name;

select
  i.sku,
  i.sku_type,
  i.item_kind,
  i.status,
  i.stock_level,
  i.physical_stock,
  i.available_stock,
  i.open_order_stock,
  i.channel_exposed_stock,
  coalesce(sum(isl.stock_level), 0) as stock_rows_total,
  jsonb_agg(
    jsonb_build_object(
      'location', isl.location_name,
      'bin', isl.bin_code,
      'qty', isl.stock_level
    )
    order by isl.location_name, isl.bin_code
  ) filter (where isl.id is not null) as stock_rows
from public.items i
left join public.item_stock_locations isl
  on isl.company_id = i.company_id
 and isl.item_id = i.id
where i.company_id = (
  select id from public.companies where slug = 'loopbase-test'
)
  and i.sku like 'TEST-%'
group by
  i.id,
  i.sku,
  i.sku_type,
  i.item_kind,
  i.status,
  i.stock_level,
  i.physical_stock,
  i.available_stock,
  i.open_order_stock,
  i.channel_exposed_stock
order by i.sku;

-- Simulate moving 1 TEST-TEE-001 from Test Warehouse / Default to Test Shop / FLOOR.
with target_item as (
  select id, company_id, sku
  from public.items
  where company_id = (
    select id from public.companies where slug = 'loopbase-test'
  )
    and sku = 'TEST-TEE-001'
),
deduct as (
  update public.item_stock_locations isl
  set
    stock_level = isl.stock_level - 1,
    source = 'loopbase_test_smoke_check',
    updated_at = now()
  from target_item ti
  where isl.company_id = ti.company_id
    and isl.item_id = ti.id
    and isl.location_name = 'LOCATION-1'
    and isl.bin_code = 'Default'
    and isl.stock_level >= 1
  returning isl.company_id, isl.item_id, isl.sku
),
add_row as (
  insert into public.item_stock_locations (
    company_id,
    item_id,
    sku,
    location_name,
    bin_code,
    stock_level,
    source,
    updated_at
  )
  select
    d.company_id,
    d.item_id,
    d.sku,
    'LOCATION-2',
    'FLOOR',
    1,
    'loopbase_test_smoke_check',
    now()
  from deduct d
  on conflict (company_id, item_id, location_name, bin_code) do update
  set
    stock_level = public.item_stock_locations.stock_level + excluded.stock_level,
    source = excluded.source,
    updated_at = now()
  returning company_id, item_id
),
row_totals as (
  select
    isl.company_id,
    isl.item_id,
    sum(coalesce(isl.stock_level, 0)) as physical_stock
  from public.item_stock_locations isl
  join add_row ar
    on ar.company_id = isl.company_id
   and ar.item_id = isl.item_id
  group by isl.company_id, isl.item_id
)
update public.items i
set
  physical_stock = rt.physical_stock,
  available_stock = rt.physical_stock
    - coalesce(i.open_order_stock, 0)
    - coalesce(i.quarantine_stock, 0)
    - coalesce(i.stock_buffer, 0),
  channel_exposed_stock = greatest(
    0,
    least(
      coalesce(i.max_channel_exposed_stock, 999999999),
      rt.physical_stock
        - coalesce(i.open_order_stock, 0)
        - coalesce(i.quarantine_stock, 0)
        - coalesce(i.stock_buffer, 0)
    )
  ),
  stock_summary_updated_at = now()
from row_totals rt
where i.company_id = rt.company_id
  and i.id = rt.item_id;

select
  'after rollback-only simulated move' as check_name,
  i.sku,
  i.physical_stock,
  i.available_stock,
  coalesce(sum(isl.stock_level), 0) as stock_rows_total,
  jsonb_agg(
    jsonb_build_object(
      'location', isl.location_name,
      'bin', isl.bin_code,
      'qty', isl.stock_level
    )
    order by isl.location_name, isl.bin_code
  ) as stock_rows
from public.items i
join public.item_stock_locations isl
  on isl.company_id = i.company_id
 and isl.item_id = i.id
where i.company_id = (
  select id from public.companies where slug = 'loopbase-test'
)
  and i.sku = 'TEST-TEE-001'
group by i.sku, i.physical_stock, i.available_stock;

rollback;

