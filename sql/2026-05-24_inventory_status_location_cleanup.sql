-- Cleanup legacy item inventory state.
-- "processed" is an order/process state, not an inventory item status.

update public.items
set
  status = 'finalised',
  updated_at = now()
where status = 'processed';

update public.items
set
  location_status = coalesce(nullif(location_status, ''), 'stored'),
  current_location = coalesce(nullif(current_location, ''), 'WAREHOUSE'),
  current_bin = coalesce(nullif(current_bin, ''), 'Default'),
  updated_at = now()
where
  current_location is null
  or current_location = ''
  or current_bin is null
  or current_bin = ''
  or location_status is null
  or location_status = ''
  or location_status = 'unknown';
