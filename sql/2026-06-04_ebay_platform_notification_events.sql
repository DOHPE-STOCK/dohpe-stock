-- General eBay platform notification audit log.
-- This is intentionally passive for now: it records received push
-- notifications without mutating stock, orders, POS, reports, or listings.

create table if not exists public.ebay_platform_notification_events (
  id uuid primary key default gen_random_uuid(),
  notification_id text null,
  event_type text null,
  topic text null,
  resource text null,
  raw_payload jsonb not null default '{}'::jsonb,
  headers jsonb not null default '{}'::jsonb,
  action_taken text not null default 'logged',
  received_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now()
);

alter table public.ebay_platform_notification_events enable row level security;

drop policy if exists "authenticated full access ebay_platform_notification_events"
on public.ebay_platform_notification_events;

create policy "authenticated full access ebay_platform_notification_events"
on public.ebay_platform_notification_events
for all
to authenticated
using (true)
with check (true);

create index if not exists ebay_platform_notification_events_received_idx
on public.ebay_platform_notification_events (received_at desc);

create index if not exists ebay_platform_notification_events_notification_idx
on public.ebay_platform_notification_events (notification_id);
