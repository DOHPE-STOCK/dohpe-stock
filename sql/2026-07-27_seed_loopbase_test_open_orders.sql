-- Seed resettable Open Orders test data for the Loopbase Test company.
--
-- Run after:
-- 1. sql/2026-07-26_loopbase_order_management_foundation.sql
-- 2. sql/2026-07-27_open_orders_capability_foundation.sql
-- 3. sql/2026-07-27_seed_loopbase_test_company.sql
--
-- Safe intent:
-- - Only touches company slug loopbase-test and order_source loopbase_test.
-- - Re-running resets these test orders and removes their old test pickwaves.

begin;

do $$
declare
  test_company_id uuid;
begin
  select id into test_company_id
  from public.companies
  where slug = 'loopbase-test';

  if test_company_id is null then
    raise exception 'Loopbase Test company not found. Run sql/2026-07-27_seed_loopbase_test_company.sql first.';
  end if;

  delete from public.loopbase_pickwaves
  where company_id = test_company_id
    and metadata->>'seed' = 'loopbase_test_open_orders';

  delete from public.loopbase_orders
  where company_id = test_company_id
    and order_source = 'loopbase_test';

  insert into public.loopbase_orders (
    company_id,
    order_source,
    external_order_id,
    external_order_number,
    channel,
    sub_channel,
    order_status,
    payment_status,
    fulfilment_status,
    stock_mode,
    buyer_name,
    buyer_email,
    currency,
    total_amount,
    ordered_at,
    order_location_name,
    shipping_method_requested,
    postal_service_name,
    identifiers,
    tags,
    raw_payload,
    updated_at
  )
  values
    (
      test_company_id,
      'loopbase_test',
      'LB-TEST-1001',
      'LB-TEST-1001',
      'eBay',
      'Sandbox',
      'reserved',
      'paid',
      'awaiting_pick',
      'reservation_only',
      'Alex Test',
      'alex@example.invalid',
      'GBP',
      34.99,
      now() - interval '45 minutes',
      'LOCATION-1',
      'Buyer selected tracked delivery',
      'Royal Mail Tracked 48',
      '[{"key":"priority","label":"Priority"}]'::jsonb,
      array['priority'],
      '{"seed":"loopbase_test_open_orders"}'::jsonb,
      now()
    ),
    (
      test_company_id,
      'loopbase_test',
      'LB-TEST-1002',
      'LB-TEST-1002',
      'Depop',
      'Test',
      'open',
      'paid',
      'awaiting_pick',
      'reservation_only',
      'Beth Example',
      'beth@example.invalid',
      'GBP',
      91.50,
      now() - interval '2 hours',
      'LOCATION-1',
      'Standard delivery',
      null,
      '[]'::jsonb,
      array[]::text[],
      '{"seed":"loopbase_test_open_orders"}'::jsonb,
      now()
    ),
    (
      test_company_id,
      'loopbase_test',
      'LB-TEST-1003',
      'LB-TEST-1003',
      'Website',
      'Loopbase Test',
      'on_hold',
      'unpaid',
      'payment_required',
      'reservation_only',
      'Chris Parked',
      'chris@example.invalid',
      'GBP',
      18.00,
      now() - interval '1 day',
      'LOCATION-2',
      'Collection',
      null,
      '[{"key":"unpaid","label":"Unpaid"}]'::jsonb,
      array['unpaid'],
      '{"seed":"loopbase_test_open_orders"}'::jsonb,
      now()
    )
  on conflict (company_id, order_source, external_order_id)
  do update set
    external_order_number = excluded.external_order_number,
    channel = excluded.channel,
    sub_channel = excluded.sub_channel,
    order_status = excluded.order_status,
    payment_status = excluded.payment_status,
    fulfilment_status = excluded.fulfilment_status,
    stock_mode = excluded.stock_mode,
    buyer_name = excluded.buyer_name,
    buyer_email = excluded.buyer_email,
    currency = excluded.currency,
    total_amount = excluded.total_amount,
    ordered_at = excluded.ordered_at,
    order_location_name = excluded.order_location_name,
    shipping_method_requested = excluded.shipping_method_requested,
    postal_service_name = excluded.postal_service_name,
    identifiers = excluded.identifiers,
    tags = excluded.tags,
    raw_payload = excluded.raw_payload,
    is_parked = case when excluded.payment_status = 'unpaid' then true else false end,
    is_locked = false,
    parked_reason = case when excluded.payment_status = 'unpaid' then 'Unpaid test order' else null end,
    locked_reason = null,
    pickwave_id = null,
    assigned_picker_staff_id = null,
    pick_claimed_at = null,
    updated_at = now();

  update public.loopbase_orders
  set
    is_parked = payment_status = 'unpaid',
    parked_reason = case when payment_status = 'unpaid' then 'Unpaid test order' else null end
  where company_id = test_company_id
    and order_source = 'loopbase_test';

  insert into public.loopbase_order_lines (
    company_id,
    order_id,
    item_id,
    sku,
    external_line_id,
    line_status,
    quantity,
    reserved_quantity,
    unit_price,
    raw_payload,
    updated_at
  )
  select
    test_company_id,
    o.id,
    i.id,
    i.sku,
    source.external_line_id,
    source.line_status,
    source.quantity,
    source.reserved_quantity,
    source.unit_price,
    '{"seed":"loopbase_test_open_orders"}'::jsonb,
    now()
  from (
    values
      ('LB-TEST-1001', 'TEST-TEE-001', '1', 'reserved', 1::numeric, 1::numeric, 34.99::numeric),
      ('LB-TEST-1002', 'TEST-JACKET-001', '1', 'open', 1::numeric, 0::numeric, 62.50::numeric),
      ('LB-TEST-1002', 'TEST-HOODIE-001', '2', 'open', 2::numeric, 0::numeric, 14.50::numeric),
      ('LB-TEST-1003', 'TEST-BAG-001', '1', 'on_hold', 1::numeric, 0::numeric, 18.00::numeric)
  ) as source(order_number, sku, external_line_id, line_status, quantity, reserved_quantity, unit_price)
  join public.loopbase_orders o
    on o.company_id = test_company_id
   and o.order_source = 'loopbase_test'
   and o.external_order_id = source.order_number
  left join public.items i
    on i.company_id = test_company_id
   and i.sku = source.sku
  on conflict (company_id, order_id, sku, external_line_id)
  do update set
    item_id = excluded.item_id,
    line_status = excluded.line_status,
    quantity = excluded.quantity,
    reserved_quantity = excluded.reserved_quantity,
    picked_quantity = 0,
    dispatched_quantity = 0,
    cancelled_quantity = 0,
    unit_price = excluded.unit_price,
    raw_payload = excluded.raw_payload,
    updated_at = now();

  insert into public.loopbase_order_identifiers (
    company_id,
    order_id,
    identifier_key,
    label,
    colour,
    source,
    metadata,
    updated_at
  )
  select
    test_company_id,
    o.id,
    'seeded-test',
    'Test',
    '#22c55e',
    'loopbase-test-seed',
    '{"seed":"loopbase_test_open_orders"}'::jsonb,
    now()
  from public.loopbase_orders o
  where o.company_id = test_company_id
    and o.order_source = 'loopbase_test'
  on conflict (company_id, order_id, identifier_key)
  do update set
    label = excluded.label,
    colour = excluded.colour,
    source = excluded.source,
    is_active = true,
    metadata = excluded.metadata,
    updated_at = now();
end $$;

select
  c.slug,
  count(distinct o.id) as seeded_orders,
  count(ol.id) as seeded_order_lines
from public.companies c
left join public.loopbase_orders o
  on o.company_id = c.id
 and o.order_source = 'loopbase_test'
left join public.loopbase_order_lines ol
  on ol.company_id = c.id
 and ol.order_id = o.id
where c.slug = 'loopbase-test'
group by c.slug;

commit;
