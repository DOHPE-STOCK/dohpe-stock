-- Stock truth foundation for Loopbase inventory.
--
-- Safe intent:
-- - Adds shadow summary fields to items for the future stock model:
--   physical, available, open orders, inbound, quarantine, channel exposed.
-- - Adds stock_reservations for open-order reservations without changing the
--   existing Linnworks order/cancellation routes yet.
-- - Adds stock_alerts for negative/low/recount alerts without wiring Telegram
--   or operational blocking yet.
-- - Does not rewrite existing POS, Linnworks, transfer, checkout, queue or
--   stock movement logic.

begin;

alter table public.items
  add column if not exists physical_stock numeric not null default 0,
  add column if not exists available_stock numeric not null default 0,
  add column if not exists open_order_stock numeric not null default 0,
  add column if not exists inbound_stock numeric not null default 0,
  add column if not exists quarantine_stock numeric not null default 0,
  add column if not exists stock_buffer numeric not null default 0,
  add column if not exists max_channel_exposed_stock numeric null,
  add column if not exists minimum_stock_alert_level numeric not null default -1,
  add column if not exists pick_policy text not null default 'company_default',
  add column if not exists channel_exposed_stock numeric not null default 0,
  add column if not exists stock_summary_updated_at timestamp with time zone null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'items_pick_policy_check'
      and conrelid = 'public.items'::regclass
  ) then
    alter table public.items drop constraint items_pick_policy_check;
  end if;

  alter table public.items
    add constraint items_pick_policy_check
    check (pick_policy in ('company_default', 'require_bin_scan', 'scan_if_multiple_bins', 'no_scan'));
end $$;

update public.items
set minimum_stock_alert_level = -1
where minimum_stock_alert_level is null;

create table if not exists public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  item_id uuid null references public.items(id) on delete set null,
  sku text not null,
  channel text not null default 'unknown',
  source text not null default 'manual',
  external_order_id text null,
  external_order_reference text null,
  reservation_status text not null default 'active',
  quantity numeric not null default 1,
  stock_already_deducted boolean not null default false,
  location_name text null,
  bin_code text null,
  reserved_at timestamp with time zone not null default now(),
  released_at timestamp with time zone null,
  deducted_at timestamp with time zone null,
  release_reason text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint stock_reservations_quantity_check check (quantity >= 0),
  constraint stock_reservations_status_check
    check (reservation_status in ('active', 'released', 'deducted', 'cancelled', 'expired'))
);

alter table public.stock_reservations
  add column if not exists stock_already_deducted boolean not null default false;

create index if not exists stock_reservations_company_status_idx
on public.stock_reservations (company_id, reservation_status, created_at desc);

create index if not exists stock_reservations_company_item_idx
on public.stock_reservations (company_id, item_id, reservation_status);

create index if not exists stock_reservations_company_order_idx
on public.stock_reservations (company_id, external_order_id, sku);

create index if not exists stock_reservations_company_active_affecting_available_idx
on public.stock_reservations (company_id, item_id, reservation_status, stock_already_deducted);

create table if not exists public.stock_alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  item_id uuid null references public.items(id) on delete set null,
  sku text null,
  alert_type text not null,
  severity text not null default 'warning',
  status text not null default 'open',
  location_name text null,
  bin_code text null,
  quantity numeric null,
  title text not null,
  message text null,
  source text not null default 'system',
  task_required boolean not null default false,
  task_status text null,
  metadata jsonb not null default '{}'::jsonb,
  resolved_at timestamp with time zone null,
  resolved_by uuid null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint stock_alerts_severity_check check (severity in ('info', 'warning', 'critical')),
  constraint stock_alerts_status_check check (status in ('open', 'acknowledged', 'resolved', 'ignored')),
  constraint stock_alerts_type_check
    check (alert_type in ('negative_stock', 'low_stock', 'oversold', 'reservation_mismatch', 'recount_required', 'sync_mismatch'))
);

create index if not exists stock_alerts_company_status_idx
on public.stock_alerts (company_id, status, created_at desc);

create index if not exists stock_alerts_company_item_idx
on public.stock_alerts (company_id, item_id, status);

create index if not exists stock_alerts_company_open_lookup_idx
on public.stock_alerts (company_id, alert_type, item_id, location_name, bin_code, status);

alter table public.stock_reservations enable row level security;
alter table public.stock_alerts enable row level security;

drop policy if exists "loopbase tenant read stock_reservations" on public.stock_reservations;
drop policy if exists "loopbase tenant manage stock_reservations" on public.stock_reservations;
drop policy if exists "loopbase tenant read stock_alerts" on public.stock_alerts;
drop policy if exists "loopbase tenant manage stock_alerts" on public.stock_alerts;

create policy "loopbase tenant read stock_reservations"
on public.stock_reservations
for select
to authenticated
using (public.loopbase_user_can_read_company(company_id));

create policy "loopbase tenant manage stock_reservations"
on public.stock_reservations
for all
to authenticated
using (public.loopbase_user_can_write_company(company_id))
with check (public.loopbase_user_can_write_company(company_id));

create policy "loopbase tenant read stock_alerts"
on public.stock_alerts
for select
to authenticated
using (public.loopbase_user_can_read_company(company_id));

create policy "loopbase tenant manage stock_alerts"
on public.stock_alerts
for all
to authenticated
using (public.loopbase_user_can_write_company(company_id))
with check (public.loopbase_user_can_write_company(company_id));

-- Initial shadow backfill: keep current item stock behaviour untouched, but
-- seed the new fields from item_stock_locations so diagnostics have a baseline.
with row_totals as (
  select
    isl.company_id,
    isl.item_id,
    sum(coalesce(isl.stock_level, 0)) as physical_stock
  from public.item_stock_locations isl
  where isl.company_id is not null
    and isl.item_id is not null
  group by isl.company_id, isl.item_id
)
update public.items i
set
  physical_stock = coalesce(rt.physical_stock, i.stock_level, 0),
  open_order_stock = coalesce(i.open_order_stock, 0),
  inbound_stock = coalesce(i.inbound_stock, 0),
  quarantine_stock = coalesce(i.quarantine_stock, 0),
  available_stock = coalesce(rt.physical_stock, i.stock_level, 0)
    - coalesce(i.open_order_stock, 0)
    - coalesce(i.quarantine_stock, 0)
    - coalesce(i.stock_buffer, 0),
  channel_exposed_stock = greatest(
    0,
    least(
      coalesce(i.max_channel_exposed_stock, 999999999),
      coalesce(rt.physical_stock, i.stock_level, 0)
        - coalesce(i.open_order_stock, 0)
        - coalesce(i.quarantine_stock, 0)
        - coalesce(i.stock_buffer, 0)
    )
  ),
  stock_summary_updated_at = now()
from row_totals rt
where i.id = rt.item_id
  and i.company_id = rt.company_id;

commit;
