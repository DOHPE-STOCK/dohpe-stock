-- Inbound / Receiving RFID foundation.
-- Run in Supabase SQL editor before using the Processing > Inbound/Receiving screens.

alter table public.items
add column if not exists inbound_batch_id uuid null,
add column if not exists inbound_batch_code text null,
add column if not exists rfid_tid text null,
add column if not exists rfid_tid_normalized text null;

create table if not exists public.inbound_batches (
  id uuid primary key default gen_random_uuid(),
  batch_code text not null unique,
  supplier_name text null,
  order_reference text null,
  source_type text not null default 'manual',
  expected_quantity integer not null default 0,
  actual_quantity integer null,
  default_brand text null,
  default_reporting_category text null,
  default_sub_category text null,
  default_item_type text null,
  cost_price numeric null,
  status text not null default 'receiving',
  notes text null,
  created_by uuid references public.staff_users(id),
  received_by uuid references public.staff_users(id),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  received_at timestamp with time zone null,

  constraint inbound_batches_quantity_check
    check (expected_quantity >= 0 and (actual_quantity is null or actual_quantity >= 0)),
  constraint inbound_batches_status_check
    check (status in ('inbound', 'receiving', 'working', 'completed', 'cancelled'))
);

alter table public.inbound_batches
add column if not exists line_total numeric null,
add column if not exists allocated_fees numeric not null default 0,
add column if not exists allocated_shipping numeric not null default 0,
add column if not exists allocated_discount numeric not null default 0;

create table if not exists public.inbound_batch_rfids (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.inbound_batches(id) on delete cascade,
  tid text not null,
  tid_normalized text not null,
  epc text null,
  item_id uuid references public.items(id) on delete set null,
  status text not null default 'available',
  scanned_at timestamp with time zone not null default now(),
  assigned_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  constraint inbound_batch_rfids_status_check
    check (status in ('available', 'assigned', 'void'))
);

create unique index if not exists inbound_batch_rfids_tid_unique
on public.inbound_batch_rfids (tid_normalized);

create index if not exists inbound_batch_rfids_batch_idx
on public.inbound_batch_rfids (batch_id, status);

create index if not exists inbound_batches_status_created_idx
on public.inbound_batches (status, created_at desc);

create index if not exists items_inbound_batch_idx
on public.items (inbound_batch_id);

create index if not exists items_rfid_tid_normalized_idx
on public.items (rfid_tid_normalized);

alter table public.inbound_batches enable row level security;
alter table public.inbound_batch_rfids enable row level security;

drop policy if exists "authenticated full access inbound_batches"
on public.inbound_batches;

create policy "authenticated full access inbound_batches"
on public.inbound_batches
for all
to authenticated
using (true)
with check (true);

drop policy if exists "authenticated full access inbound_batch_rfids"
on public.inbound_batch_rfids;

create policy "authenticated full access inbound_batch_rfids"
on public.inbound_batch_rfids
for all
to authenticated
using (true)
with check (true);

create or replace function public.normalize_inbound_rfid()
returns trigger
language plpgsql
as $$
begin
  new.tid_normalized := upper(regexp_replace(trim(new.tid), '\s+', '', 'g'));
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists normalize_inbound_rfid_trigger
on public.inbound_batch_rfids;

create trigger normalize_inbound_rfid_trigger
before insert or update
on public.inbound_batch_rfids
for each row
execute function public.normalize_inbound_rfid();

create or replace function public.normalize_item_rfid_tid()
returns trigger
language plpgsql
as $$
begin
  if new.rfid_tid is null or trim(new.rfid_tid) = '' then
    new.rfid_tid_normalized := null;
  else
    new.rfid_tid_normalized := upper(regexp_replace(trim(new.rfid_tid), '\s+', '', 'g'));
  end if;

  return new;
end;
$$;

drop trigger if exists normalize_item_rfid_tid_trigger
on public.items;

create trigger normalize_item_rfid_tid_trigger
before insert or update of rfid_tid
on public.items
for each row
execute function public.normalize_item_rfid_tid();
