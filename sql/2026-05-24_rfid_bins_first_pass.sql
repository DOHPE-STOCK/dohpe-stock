-- First pass: location-scoped bins and RFID/item identifiers.
-- Run in Supabase SQL editor.

-- Allow the same bin code at different locations, such as SHOP-1 / STOCK
-- and SHOP-2 / STOCK. Keep uniqueness scoped to location + bin.
alter table public.warehouse_bins
drop constraint if exists warehouse_bins_bin_code_key;

drop index if exists public.warehouse_bins_bin_code_key;

create unique index if not exists warehouse_bins_location_bin_unique
on public.warehouse_bins (location_name, bin_code);

-- Generic item lookup table for RFID, SKU, barcode, and future identifiers.
create table if not exists public.item_identifiers (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  sku text not null,
  identifier_type text not null,
  identifier_value text not null,
  identifier_value_normalized text not null,
  is_active boolean not null default true,
  assigned_at timestamp with time zone not null default now(),
  assigned_by uuid references public.staff_users(id),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  constraint item_identifiers_identifier_type_check
    check (identifier_type in ('rfid', 'barcode', 'sku', 'external'))
);

create unique index if not exists item_identifiers_active_value_unique
on public.item_identifiers (identifier_value_normalized)
where is_active = true;

create index if not exists item_identifiers_item_id_idx
on public.item_identifiers (item_id);

create index if not exists item_identifiers_sku_idx
on public.item_identifiers (sku);

create index if not exists item_identifiers_type_value_idx
on public.item_identifiers (identifier_type, identifier_value_normalized);

alter table public.item_identifiers enable row level security;

drop policy if exists "authenticated full access item_identifiers"
on public.item_identifiers;

create policy "authenticated full access item_identifiers"
on public.item_identifiers
for all
to authenticated
using (true)
with check (true);

create or replace function public.normalize_item_identifier()
returns trigger
language plpgsql
as $$
begin
  new.identifier_value_normalized :=
    upper(regexp_replace(trim(new.identifier_value), '\s+', '', 'g'));

  new.sku := upper(trim(new.sku));
  new.identifier_type := lower(trim(new.identifier_type));
  new.updated_at := now();

  return new;
end;
$$;

drop trigger if exists normalize_item_identifier_trigger
on public.item_identifiers;

create trigger normalize_item_identifier_trigger
before insert or update
on public.item_identifiers
for each row
execute function public.normalize_item_identifier();

-- Seed current SKU and barcode values into the lookup table.
insert into public.item_identifiers (
  item_id,
  sku,
  identifier_type,
  identifier_value,
  identifier_value_normalized,
  is_active
)
select
  id,
  sku,
  'sku',
  sku,
  upper(regexp_replace(trim(sku), '\s+', '', 'g')),
  true
from public.items
where sku is not null
on conflict do nothing;

insert into public.item_identifiers (
  item_id,
  sku,
  identifier_type,
  identifier_value,
  identifier_value_normalized,
  is_active
)
select
  id,
  sku,
  'barcode',
  barcode_number,
  upper(regexp_replace(trim(barcode_number), '\s+', '', 'g')),
  true
from public.items
where barcode_number is not null
  and trim(barcode_number) <> ''
on conflict do nothing;

-- Give existing staff an explicit Inventory permission. Existing working users
-- keep access, and admin/manager/scanner roles get the intended default.
update public.staff_users
set permissions = jsonb_set(
  coalesce(permissions, '{}'::jsonb),
  '{inventory}',
  to_jsonb(
    coalesce(
      (permissions ->> 'working')::boolean,
      role in ('admin', 'manager', 'staff', 'scanner'),
      false
    )
  ),
  true
);
