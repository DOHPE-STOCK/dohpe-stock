-- Channel pending-update/error fields used by inventory warnings.
-- Safe: adds nullable columns only. Existing channel status text values are preserved.

alter table public.items
  add column if not exists linnworks_sync_error text,
  add column if not exists ebay_sync_error text,
  add column if not exists shopify_sync_error text,
  add column if not exists square_sync_error text,
  add column if not exists grailed_sync_error text,
  add column if not exists vestiaire_collective_sync_error text,
  add column if not exists whatnot_sync_error text,
  add column if not exists vinted_sync_error text,
  add column if not exists depop_sync_error text,
  add column if not exists tiktok_shop_sync_error text,
  add column if not exists channel_pending_update_at timestamp with time zone;

create index if not exists items_company_channel_pending_update_idx
on public.items (company_id, channel_pending_update_at desc)
where channel_pending_update_at is not null;
