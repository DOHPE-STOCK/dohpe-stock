-- Read-only RFID smoke check.
-- Expected: table_exists = true after 2026-05-24_rfid_bins_first_pass.sql has run.

select
  to_regclass('public.item_identifiers') is not null as table_exists,
  count(*) filter (where identifier_type = 'rfid') as active_rfid_count,
  count(*) filter (where identifier_type = 'sku') as sku_identifier_count,
  count(*) filter (where identifier_type = 'barcode') as barcode_identifier_count
from public.item_identifiers
where is_active = true;

select
  ii.identifier_type,
  ii.identifier_value_normalized,
  i.sku,
  i.current_location,
  i.current_bin
from public.item_identifiers ii
join public.items i on i.id = ii.item_id
where ii.identifier_type = 'rfid'
  and ii.is_active = true
order by ii.created_at desc
limit 10;
