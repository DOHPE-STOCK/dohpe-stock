-- RFID zone/security foundation.
--
-- Tenant-scoped RFID threshold zones for changing rooms, stock rooms,
-- entrances/exits and other doorway/threshold readers.

begin;

create table if not exists public.rfid_zones (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  code text not null,
  zone_type text not null default 'movement_log',
  status text not null default 'active',
  location_id uuid null references public.locations(id) on delete set null,
  description text null,
  token_hash text null,
  token_last_four text null,
  token_created_at timestamp with time zone null,
  token_revoked_at timestamp with time zone null,
  antenna_map jsonb not null default '[]'::jsonb,
  rules jsonb not null default '{}'::jsonb,
  last_seen_at timestamp with time zone null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint rfid_zones_company_code_unique unique (company_id, code),
  constraint rfid_zones_type_check check (zone_type in ('movement_log', 'restricted_area', 'exit_security', 'stock_room', 'changing_room', 'custom')),
  constraint rfid_zones_status_check check (status in ('active', 'disabled', 'archived'))
);

create unique index if not exists rfid_zones_token_hash_unique_idx
on public.rfid_zones (token_hash)
where token_hash is not null and token_revoked_at is null;

create index if not exists rfid_zones_company_status_idx
on public.rfid_zones (company_id, status, name);

create table if not exists public.rfid_zone_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  zone_id uuid not null references public.rfid_zones(id) on delete cascade,
  item_id uuid null references public.items(id) on delete set null,
  tag_key text not null,
  epc text null,
  tid text null,
  event_type text not null,
  direction text null,
  first_side text null,
  last_side text null,
  last_antenna integer null,
  max_rssi numeric null,
  read_count integer not null default 0,
  known_item boolean not null default false,
  paid_or_sold boolean not null default false,
  alarm_triggered boolean not null default false,
  alarm_status text not null default 'none',
  metadata jsonb not null default '{}'::jsonb,
  event_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  constraint rfid_zone_events_type_check check (event_type in ('read', 'entered', 'exited', 'inside', 'outside', 'stale_inside', 'alarm', 'cleared')),
  constraint rfid_zone_events_alarm_status_check check (alarm_status in ('none', 'pending', 'triggered', 'acknowledged', 'dismissed'))
);

create index if not exists rfid_zone_events_company_zone_time_idx
on public.rfid_zone_events (company_id, zone_id, event_at desc);

create index if not exists rfid_zone_events_company_alarm_idx
on public.rfid_zone_events (company_id, alarm_status, event_at desc)
where alarm_triggered is true;

create index if not exists rfid_zone_events_company_item_idx
on public.rfid_zone_events (company_id, item_id, event_at desc)
where item_id is not null;

alter table public.rfid_zones enable row level security;
alter table public.rfid_zone_events enable row level security;

drop policy if exists "loopbase tenant read rfid_zones" on public.rfid_zones;
create policy "loopbase tenant read rfid_zones"
on public.rfid_zones for select to authenticated
using (public.loopbase_user_can_read_company(company_id));

drop policy if exists "loopbase tenant manage rfid_zones" on public.rfid_zones;
create policy "loopbase tenant manage rfid_zones"
on public.rfid_zones for all to authenticated
using (public.loopbase_user_can_write_company(company_id))
with check (public.loopbase_user_can_write_company(company_id));

drop policy if exists "loopbase tenant read rfid_zone_events" on public.rfid_zone_events;
create policy "loopbase tenant read rfid_zone_events"
on public.rfid_zone_events for select to authenticated
using (public.loopbase_user_can_read_company(company_id));

drop policy if exists "loopbase tenant manage rfid_zone_events" on public.rfid_zone_events;
create policy "loopbase tenant manage rfid_zone_events"
on public.rfid_zone_events for all to authenticated
using (public.loopbase_user_can_write_company(company_id))
with check (public.loopbase_user_can_write_company(company_id));

commit;
