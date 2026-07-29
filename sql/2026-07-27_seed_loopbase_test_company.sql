-- Seed an internal/unlimited test company with sample stock.
--
-- Safe intent:
-- - Creates/updates a separate "Loopbase Test" company.
-- - Adds it to David's existing Supabase login as owner/admin.
-- - Seeds default locations, channel placeholders, one staff profile and 5
--   dummy Standard SKUs with stock rows.
-- - Does not touch DOHPE/DL Retail stock or integrations.

begin;

with target_user as (
  select id, email
  from auth.users
  where lower(email) = 'admin@dohpevintage.com'
  order by created_at
  limit 1
),
fallback_user as (
  select cm.user_id as id, au.email
  from public.company_memberships cm
  join public.companies c on c.id = cm.company_id
  join auth.users au on au.id = cm.user_id
  where c.slug = 'dohpe'
    and cm.status = 'active'
    and cm.role in ('owner', 'admin')
  order by
    case when lower(au.email) = 'admin@dohpevintage.com' then 0 else 1 end,
    cm.created_at
  limit 1
),
chosen_user as (
  select * from target_user
  union all
  select * from fallback_user
  where not exists (select 1 from target_user)
),
upsert_company as (
  insert into public.companies (
    name,
    slug,
    trading_name,
    access_state,
    billing_exempt,
    billing_exempt_reason,
    internal_account,
    plan_key,
    subscription_status,
    created_by_user_id,
    updated_at
  )
  select
    'Loopbase Test',
    'loopbase-test',
    'Loopbase Test',
    'active',
    true,
    'Internal unlimited sandbox/test company',
    true,
    'internal_lifetime',
    'manual_active',
    chosen_user.id,
    now()
  from chosen_user
  on conflict (slug) do update
  set
    name = excluded.name,
    trading_name = excluded.trading_name,
    access_state = 'active',
    billing_exempt = true,
    billing_exempt_reason = excluded.billing_exempt_reason,
    internal_account = true,
    plan_key = 'internal_lifetime',
    subscription_status = 'manual_active',
    service_restricted_at = null,
    archived_at = null,
    updated_at = now()
  returning id
),
test_company as (
  select id from upsert_company
  union
  select id from public.companies where slug = 'loopbase-test'
),
membership_upsert as (
  insert into public.company_memberships (
    company_id,
    user_id,
    role,
    status,
    permissions,
    joined_at,
    updated_at
  )
  select
    test_company.id,
    chosen_user.id,
    'owner',
    'active',
    '{"internal_test_account": true}'::jsonb,
    now(),
    now()
  from test_company
  cross join chosen_user
  on conflict (company_id, user_id) do update
  set
    role = 'owner',
    status = 'active',
    permissions = coalesce(public.company_memberships.permissions, '{}'::jsonb) || excluded.permissions,
    joined_at = coalesce(public.company_memberships.joined_at, now()),
    updated_at = now()
  returning id
)
update public.company_subscriptions cs
set
  plan_key = 'internal_lifetime',
  status = 'manual_active',
  provider = 'manual',
  current_period_start = coalesce(cs.current_period_start, now()),
  current_period_end = null,
  cancel_at = null,
  cancelled_at = null,
  metadata = coalesce(cs.metadata, '{}'::jsonb) || '{"internal_test_account": true}'::jsonb,
  updated_at = now()
from test_company
where cs.company_id = test_company.id
  and cs.provider = 'manual';

with test_company as (
  select id from public.companies where slug = 'loopbase-test'
)
insert into public.company_subscriptions (
  company_id,
  plan_key,
  status,
  provider,
  current_period_start,
  current_period_end,
  metadata,
  updated_at
)
select
  test_company.id,
  'internal_lifetime',
  'manual_active',
  'manual',
  now(),
  null,
  '{"internal_test_account": true}'::jsonb,
  now()
from test_company
where not exists (
  select 1
  from public.company_subscriptions existing
  where existing.company_id = test_company.id
    and existing.provider = 'manual'
);

with test_company as (
  select id from public.companies where slug = 'loopbase-test'
),
location_seed(code, name, label, is_retail, floor_bin_code, is_default_receiving, sort_order) as (
  values
    ('LOCATION-1', 'LOCATION-1', 'Test Warehouse', false, null, true, 1),
    ('LOCATION-2', 'LOCATION-2', 'Test Shop', true, 'FLOOR', false, 2)
)
update public.locations l
set
  label = ls.label,
  is_active = true,
  location_type = 'stock',
  is_retail = ls.is_retail,
  floor_bin_code = ls.floor_bin_code,
  default_receiving_bin = 'Default',
  is_default_receiving = ls.is_default_receiving,
  sort_order = ls.sort_order,
  metadata = coalesce(l.metadata, '{}'::jsonb) || '{"seeded_for": "loopbase_test"}'::jsonb
from test_company
cross join location_seed ls
where l.company_id = test_company.id
  and l.code = ls.code;

with test_company as (
  select id from public.companies where slug = 'loopbase-test'
),
location_seed(code, name, label, is_retail, floor_bin_code, is_default_receiving, sort_order) as (
  values
    ('LOCATION-1', 'LOCATION-1', 'Test Warehouse', false, null, true, 1),
    ('LOCATION-2', 'LOCATION-2', 'Test Shop', true, 'FLOOR', false, 2)
)
insert into public.locations (
  company_id,
  code,
  name,
  label,
  bin_mode,
  basic_bins,
  is_active,
  location_type,
  is_retail,
  floor_bin_code,
  default_receiving_bin,
  is_default_receiving,
  sort_order,
  metadata
)
select
  test_company.id,
  ls.code,
  ls.name,
  ls.label,
  'range',
  '{}'::text[],
  true,
  'stock',
  ls.is_retail,
  ls.floor_bin_code,
  'Default',
  ls.is_default_receiving,
  ls.sort_order,
  '{"seeded_for": "loopbase_test"}'::jsonb
from test_company
cross join location_seed ls
where not exists (
  select 1
  from public.locations existing
  where existing.company_id = test_company.id
    and existing.code = ls.code
);

with test_company as (
  select id from public.companies where slug = 'loopbase-test'
),
bin_seed(location_name, bin_code, display_name, bin_type, is_floor, is_sellable, is_pickable) as (
  values
    ('LOCATION-1', 'Default', 'Default', 'default', false, true, true),
    ('LOCATION-1', 'TEST-A1', 'TEST-A1', 'stock', false, true, true),
    ('LOCATION-1', 'QUARANTINE', 'QUARANTINE', 'quarantine', false, false, true),
    ('LOCATION-2', 'Default', 'Default', 'default', false, true, true),
    ('LOCATION-2', 'FLOOR', 'FLOOR', 'floor', true, true, true),
    ('LOCATION-2', 'STOCK', 'STOCK', 'stock', false, true, true)
)
update public.warehouse_bins wb
set
  label = bs.display_name,
  display_name = bs.display_name,
  bin_type = bs.bin_type,
  is_floor = bs.is_floor,
  is_sellable = bs.is_sellable,
  is_pickable = bs.is_pickable,
  is_active = true,
  updated_at = now()
from test_company
cross join bin_seed bs
where wb.company_id = test_company.id
  and wb.location_name = bs.location_name
  and wb.bin_code = bs.bin_code;

with test_company as (
  select id from public.companies where slug = 'loopbase-test'
),
bin_seed(location_name, bin_code, display_name, bin_type, is_floor, is_sellable, is_pickable) as (
  values
    ('LOCATION-1', 'Default', 'Default', 'default', false, true, true),
    ('LOCATION-1', 'TEST-A1', 'TEST-A1', 'stock', false, true, true),
    ('LOCATION-1', 'QUARANTINE', 'QUARANTINE', 'quarantine', false, false, true),
    ('LOCATION-2', 'Default', 'Default', 'default', false, true, true),
    ('LOCATION-2', 'FLOOR', 'FLOOR', 'floor', true, true, true),
    ('LOCATION-2', 'STOCK', 'STOCK', 'stock', false, true, true)
)
insert into public.warehouse_bins (
  company_id,
  location_name,
  bin_code,
  label,
  display_name,
  bin_type,
  is_floor,
  is_sellable,
  is_pickable,
  is_active,
  updated_at
)
select
  test_company.id,
  bs.location_name,
  bs.bin_code,
  bs.display_name,
  bs.display_name,
  bs.bin_type,
  bs.is_floor,
  bs.is_sellable,
  bs.is_pickable,
  true,
  now()
from test_company
cross join bin_seed bs
where not exists (
  select 1
  from public.warehouse_bins existing
  where existing.company_id = test_company.id
    and existing.location_name = bs.location_name
    and existing.bin_code = bs.bin_code
);

with test_company as (
  select id from public.companies where slug = 'loopbase-test'
),
channel_seed(channel) as (
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
  test_company.id,
  channel_seed.channel,
  false,
  false,
  'not_configured',
  '{}'::jsonb
from test_company
cross join channel_seed
where not exists (
  select 1
  from public.integration_settings existing
  where existing.company_id = test_company.id
    and existing.channel = channel_seed.channel
);

with test_company as (
  select id from public.companies where slug = 'loopbase-test'
),
target_user as (
  select id, email
  from auth.users
  where lower(email) = 'admin@dohpevintage.com'
  order by created_at
  limit 1
),
fallback_user as (
  select cm.user_id as id, au.email
  from public.company_memberships cm
  join public.companies c on c.id = cm.company_id
  join auth.users au on au.id = cm.user_id
  where c.slug = 'dohpe'
    and cm.status = 'active'
    and cm.role in ('owner', 'admin')
  order by
    case when lower(au.email) = 'admin@dohpevintage.com' then 0 else 1 end,
    cm.created_at
  limit 1
),
chosen_user as (
  select * from target_user
  union all
  select * from fallback_user
  where not exists (select 1 from target_user)
)
insert into public.staff_users (
  company_id,
  auth_user_id,
  name,
  pin_code,
  is_active,
  must_change_pin,
  role,
  permissions,
  payroll_settings,
  pin_timeout_minutes
)
select
  test_company.id,
  chosen_user.id,
  'Test Staff',
  '1234',
  true,
  false,
  'admin',
  '{"catalogue": true, "settings": true, "checkout": true}'::jsonb,
  '{"include_in_payroll": false, "include_in_holiday": false}'::jsonb,
  30
from test_company
left join chosen_user on true
where not exists (
  select 1
  from public.staff_users existing
  where existing.company_id = test_company.id
    and lower(trim(existing.name)) = 'test staff'
);

with test_company as (
  select id from public.companies where slug = 'loopbase-test'
),
sample_items(sku, title, brand, category, sub_category, qty, shop_qty, price) as (
  values
    ('TEST-TEE-001', 'Loopbase Test T-Shirt', 'Loopbase Test', 'T-Shirt', 'Graphic T-Shirt', 7::numeric, 2::numeric, 18.00::numeric),
    ('TEST-JACKET-001', 'Loopbase Test Jacket', 'Loopbase Test', 'Jacket', 'Workwear Jacket', 3::numeric, 1::numeric, 45.00::numeric),
    ('TEST-JEANS-001', 'Loopbase Test Jeans', 'Loopbase Test', 'Jeans', 'Straight Jeans', 5::numeric, 0::numeric, 32.00::numeric),
    ('TEST-BAG-001', 'Loopbase Test Bag', 'Loopbase Test', 'Bag', 'Shoulder Bag', 4::numeric, 1::numeric, 28.00::numeric),
    ('TEST-HOODIE-001', 'Loopbase Test Hoodie', 'Loopbase Test', 'Hoodie', 'Pullover Hoodie', 9::numeric, 3::numeric, 24.00::numeric)
)
update public.items i
set
  barcode_number = si.sku,
  sku_type = 'standard',
  item_kind = 'standard',
  status = 'working',
  brand = si.brand,
  reporting_category = si.category,
  sub_category = si.sub_category,
  basic_title = si.title,
  final_title = si.title,
  condition = 'Pre-owned - Good',
  stock_level = si.qty,
  physical_stock = si.qty,
  available_stock = si.qty,
  open_order_stock = 0,
  inbound_stock = 0,
  quarantine_stock = 0,
  channel_exposed_stock = si.qty,
  stock_buffer = 0,
  minimum_stock_alert_level = -1,
  selling_price = si.price,
  cost_price = round(si.price * 0.35, 2),
  location_status = 'stored',
  current_location = 'LOCATION-1',
  current_bin = 'Default',
  loan_status = 'not_on_loan',
  updated_at = now()
from test_company
cross join sample_items si
where i.company_id = test_company.id
  and upper(trim(i.sku)) = upper(trim(si.sku));

with test_company as (
  select id from public.companies where slug = 'loopbase-test'
),
sample_items(sku, title, brand, category, sub_category, qty, shop_qty, price) as (
  values
    ('TEST-TEE-001', 'Loopbase Test T-Shirt', 'Loopbase Test', 'T-Shirt', 'Graphic T-Shirt', 7::numeric, 2::numeric, 18.00::numeric),
    ('TEST-JACKET-001', 'Loopbase Test Jacket', 'Loopbase Test', 'Jacket', 'Workwear Jacket', 3::numeric, 1::numeric, 45.00::numeric),
    ('TEST-JEANS-001', 'Loopbase Test Jeans', 'Loopbase Test', 'Jeans', 'Straight Jeans', 5::numeric, 0::numeric, 32.00::numeric),
    ('TEST-BAG-001', 'Loopbase Test Bag', 'Loopbase Test', 'Bag', 'Shoulder Bag', 4::numeric, 1::numeric, 28.00::numeric),
    ('TEST-HOODIE-001', 'Loopbase Test Hoodie', 'Loopbase Test', 'Hoodie', 'Pullover Hoodie', 9::numeric, 3::numeric, 24.00::numeric)
)
insert into public.items (
  company_id,
  sku,
  barcode_number,
  sku_type,
  item_kind,
  status,
  brand,
  reporting_category,
  sub_category,
  basic_title,
  final_title,
  condition,
  stock_level,
  physical_stock,
  available_stock,
  open_order_stock,
  inbound_stock,
  quarantine_stock,
  channel_exposed_stock,
  stock_buffer,
  minimum_stock_alert_level,
  selling_price,
  cost_price,
  location_status,
  current_location,
  current_bin,
  loan_status,
  ebay_status,
  linnworks_status,
  shopify_status,
  square_status,
  grailed_status,
  vestiaire_collective_status,
  whatnot_status,
  vinted_status,
  depop_status,
  tiktok_shop_status,
  updated_at
)
select
  test_company.id,
  si.sku,
  si.sku,
  'standard',
  'standard',
  'working',
  si.brand,
  si.category,
  si.sub_category,
  si.title,
  si.title,
  'Pre-owned - Good',
  si.qty,
  si.qty,
  si.qty,
  0,
  0,
  0,
  si.qty,
  0,
  -1,
  si.price,
  round(si.price * 0.35, 2),
  'stored',
  'LOCATION-1',
  'Default',
  'not_on_loan',
  'not_listed',
  'not_synced',
  'not_listed',
  'not_listed',
  'not_listed',
  'not_listed',
  'not_listed',
  'not_listed',
  'not_listed',
  'not_listed',
  now()
from test_company
cross join sample_items si
where not exists (
  select 1
  from public.items existing
  where existing.company_id = test_company.id
    and upper(trim(existing.sku)) = upper(trim(si.sku))
);

with target_items as (
  select i.id, i.company_id, i.sku
  from public.items i
  join public.companies c
    on c.id = i.company_id
   and c.slug = 'loopbase-test'
  where i.sku like 'TEST-%'
)
update public.item_identifiers ii
set
  item_id = ti.id,
  sku = ti.sku,
  updated_at = now()
from target_items ti
where ii.company_id = ti.company_id
  and ii.identifier_type = 'barcode'
  and ii.identifier_value_normalized = upper(trim(ti.sku))
  and ii.is_active is true;

with target_items as (
  select i.id, i.company_id, i.sku
  from public.items i
  join public.companies c
    on c.id = i.company_id
   and c.slug = 'loopbase-test'
  where i.sku like 'TEST-%'
)
insert into public.item_identifiers (
  company_id,
  item_id,
  sku,
  identifier_type,
  identifier_value,
  identifier_value_normalized,
  is_active,
  updated_at
)
select
  ti.company_id,
  ti.id,
  ti.sku,
  'barcode',
  ti.sku,
  upper(trim(ti.sku)),
  true,
  now()
from target_items ti
where not exists (
  select 1
  from public.item_identifiers existing
  where existing.company_id = ti.company_id
    and existing.identifier_type = 'barcode'
    and existing.identifier_value_normalized = upper(trim(ti.sku))
    and existing.is_active is true
);

with test_company as (
  select id from public.companies where slug = 'loopbase-test'
),
sample_items(sku, warehouse_default_qty, warehouse_a1_qty, shop_floor_qty) as (
  values
    ('TEST-TEE-001', 4::numeric, 1::numeric, 2::numeric),
    ('TEST-JACKET-001', 2::numeric, 0::numeric, 1::numeric),
    ('TEST-JEANS-001', 3::numeric, 2::numeric, 0::numeric),
    ('TEST-BAG-001', 2::numeric, 1::numeric, 1::numeric),
    ('TEST-HOODIE-001', 5::numeric, 1::numeric, 3::numeric)
),
target_rows as (
  select i.company_id, i.id as item_id, i.sku, 'LOCATION-1'::text as location_name, 'Default'::text as bin_code, si.warehouse_default_qty as stock_level
  from public.items i
  join test_company tc on tc.id = i.company_id
  join sample_items si on si.sku = i.sku
  union all
  select i.company_id, i.id, i.sku, 'LOCATION-1', 'TEST-A1', si.warehouse_a1_qty
  from public.items i
  join test_company tc on tc.id = i.company_id
  join sample_items si on si.sku = i.sku
  union all
  select i.company_id, i.id, i.sku, 'LOCATION-2', 'FLOOR', si.shop_floor_qty
  from public.items i
  join test_company tc on tc.id = i.company_id
  join sample_items si on si.sku = i.sku
)
update public.item_stock_locations isl
set
  sku = tr.sku,
  stock_level = tr.stock_level,
  source = 'loopbase_test_seed',
  updated_at = now()
from target_rows tr
where isl.company_id = tr.company_id
  and isl.item_id = tr.item_id
  and isl.location_name = tr.location_name
  and isl.bin_code = tr.bin_code;

with test_company as (
  select id from public.companies where slug = 'loopbase-test'
),
sample_items(sku, warehouse_default_qty, warehouse_a1_qty, shop_floor_qty) as (
  values
    ('TEST-TEE-001', 4::numeric, 1::numeric, 2::numeric),
    ('TEST-JACKET-001', 2::numeric, 0::numeric, 1::numeric),
    ('TEST-JEANS-001', 3::numeric, 2::numeric, 0::numeric),
    ('TEST-BAG-001', 2::numeric, 1::numeric, 1::numeric),
    ('TEST-HOODIE-001', 5::numeric, 1::numeric, 3::numeric)
),
target_rows as (
  select i.company_id, i.id as item_id, i.sku, 'LOCATION-1'::text as location_name, 'Default'::text as bin_code, si.warehouse_default_qty as stock_level
  from public.items i
  join test_company tc on tc.id = i.company_id
  join sample_items si on si.sku = i.sku
  union all
  select i.company_id, i.id, i.sku, 'LOCATION-1', 'TEST-A1', si.warehouse_a1_qty
  from public.items i
  join test_company tc on tc.id = i.company_id
  join sample_items si on si.sku = i.sku
  union all
  select i.company_id, i.id, i.sku, 'LOCATION-2', 'FLOOR', si.shop_floor_qty
  from public.items i
  join test_company tc on tc.id = i.company_id
  join sample_items si on si.sku = i.sku
)
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
  company_id,
  item_id,
  sku,
  location_name,
  bin_code,
  stock_level,
  'loopbase_test_seed',
  now()
from target_rows
where stock_level > 0
  and not exists (
    select 1
    from public.item_stock_locations existing
    where existing.company_id = target_rows.company_id
      and existing.item_id = target_rows.item_id
      and existing.location_name = target_rows.location_name
      and existing.bin_code = target_rows.bin_code
  );

select
  c.name,
  c.slug,
  c.plan_key,
  c.subscription_status,
  c.billing_exempt,
  count(distinct i.id) as seeded_items,
  coalesce(sum(isl.stock_level), 0) as seeded_stock_rows_total
from public.companies c
left join public.items i
  on i.company_id = c.id
 and i.sku like 'TEST-%'
left join public.item_stock_locations isl
  on isl.company_id = i.company_id
 and isl.item_id = i.id
where c.slug = 'loopbase-test'
group by c.name, c.slug, c.plan_key, c.subscription_status, c.billing_exempt;

commit;
