-- eBay marketplace account deletion / closure notification audit log.
-- This records compliance events without deleting internal sales, stock,
-- reports, or operational history.

create table if not exists public.ebay_account_deletion_events (
  id uuid primary key default gen_random_uuid(),
  notification_id text null,
  event_type text null,
  ebay_user_id text null,
  ebay_username text null,
  raw_payload jsonb not null default '{}'::jsonb,
  action_taken text not null default 'logged',
  received_at timestamp with time zone not null default now(),
  processed_at timestamp with time zone null,
  created_at timestamp with time zone not null default now()
);

alter table public.ebay_account_deletion_events enable row level security;

drop policy if exists "authenticated full access ebay_account_deletion_events"
on public.ebay_account_deletion_events;

create policy "authenticated full access ebay_account_deletion_events"
on public.ebay_account_deletion_events
for all
to authenticated
using (true)
with check (true);

create index if not exists ebay_account_deletion_events_received_idx
on public.ebay_account_deletion_events (received_at desc);

create index if not exists ebay_account_deletion_events_notification_idx
on public.ebay_account_deletion_events (notification_id);
