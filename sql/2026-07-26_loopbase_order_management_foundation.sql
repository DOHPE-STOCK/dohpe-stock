-- Source-agnostic Loopbase order management foundation.
--
-- Safe intent:
-- - Adds Loopbase-owned order/order-line tables so Linnworks, direct eBay,
--   POS, Shopify, etc. can feed the same open-order/reservation model.
-- - Existing Linnworks processed-sales and transfer logic remains in place.
-- - Rows are tenant scoped and RLS-protected.

begin;

create table if not exists public.loopbase_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_source text not null,
  external_order_id text not null,
  external_order_number text null,
  channel text not null default 'unknown',
  sub_channel text null,
  order_status text not null default 'open',
  payment_status text null,
  fulfilment_status text null,
  stock_mode text not null default 'reservation_only',
  buyer_name text null,
  buyer_email text null,
  currency text null,
  total_amount numeric null,
  order_created_at timestamp with time zone null,
  ordered_at timestamp with time zone null,
  processed_at timestamp with time zone null,
  cancelled_at timestamp with time zone null,
  cancellation_reason text null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint loopbase_orders_source_order_unique unique (company_id, order_source, external_order_id),
  constraint loopbase_orders_status_check
    check (order_status in ('open', 'reserved', 'picking', 'part_picked', 'picked', 'dispatched', 'cancelled', 'on_hold', 'failed')),
  constraint loopbase_orders_stock_mode_check
    check (stock_mode in ('reservation_only', 'physical_deducted', 'external_managed'))
);

create index if not exists loopbase_orders_company_status_idx
on public.loopbase_orders (company_id, order_status, updated_at desc);

create index if not exists loopbase_orders_company_channel_idx
on public.loopbase_orders (company_id, channel, order_status);

create table if not exists public.loopbase_order_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null references public.loopbase_orders(id) on delete cascade,
  item_id uuid null references public.items(id) on delete set null,
  sku text not null,
  external_line_id text null,
  line_status text not null default 'open',
  quantity numeric not null default 1,
  reserved_quantity numeric not null default 0,
  picked_quantity numeric not null default 0,
  dispatched_quantity numeric not null default 0,
  cancelled_quantity numeric not null default 0,
  reservation_id uuid null references public.stock_reservations(id) on delete set null,
  transfer_item_ids uuid[] not null default '{}',
  unit_price numeric null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint loopbase_order_lines_source_line_unique unique (company_id, order_id, sku, external_line_id),
  constraint loopbase_order_lines_quantity_check check (quantity >= 0),
  constraint loopbase_order_lines_status_check
    check (line_status in ('open', 'reserved', 'picking', 'picked', 'dispatched', 'cancelled', 'failed', 'on_hold'))
);

create index if not exists loopbase_order_lines_company_status_idx
on public.loopbase_order_lines (company_id, line_status, updated_at desc);

create index if not exists loopbase_order_lines_company_item_idx
on public.loopbase_order_lines (company_id, item_id, line_status);

create index if not exists loopbase_order_lines_company_sku_idx
on public.loopbase_order_lines (company_id, sku, line_status);

alter table public.loopbase_orders enable row level security;
alter table public.loopbase_order_lines enable row level security;

drop policy if exists "loopbase tenant read loopbase_orders" on public.loopbase_orders;
drop policy if exists "loopbase tenant manage loopbase_orders" on public.loopbase_orders;
drop policy if exists "loopbase tenant read loopbase_order_lines" on public.loopbase_order_lines;
drop policy if exists "loopbase tenant manage loopbase_order_lines" on public.loopbase_order_lines;

create policy "loopbase tenant read loopbase_orders"
on public.loopbase_orders
for select
to authenticated
using (public.loopbase_user_can_read_company(company_id));

create policy "loopbase tenant manage loopbase_orders"
on public.loopbase_orders
for all
to authenticated
using (public.loopbase_user_can_write_company(company_id))
with check (public.loopbase_user_can_write_company(company_id));

create policy "loopbase tenant read loopbase_order_lines"
on public.loopbase_order_lines
for select
to authenticated
using (public.loopbase_user_can_read_company(company_id));

create policy "loopbase tenant manage loopbase_order_lines"
on public.loopbase_order_lines
for all
to authenticated
using (public.loopbase_user_can_write_company(company_id))
with check (public.loopbase_user_can_write_company(company_id));

commit;
