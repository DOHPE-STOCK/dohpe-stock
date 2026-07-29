-- Open Orders capability foundation.
--
-- Safe intent:
-- - Extends Loopbase order rows with Linnworks-like open-order workflow fields.
-- - Adds saved views/custom columns, identifiers, notes, and pickwave tables.
-- - Does not change POS, Linnworks queue, transfer, checkout, or stock deduction logic.

begin;

alter table public.loopbase_orders
  add column if not exists loopbase_account_id uuid null references auth.users(id) on delete set null,
  add column if not exists loopbase_order_number bigint null,
  add column if not exists buyer_username text null,
  add column if not exists shipping_address jsonb not null default '{}'::jsonb,
  add column if not exists shipping_country text null,
  add column if not exists shipping_cost numeric null,
  add column if not exists order_location_name text null,
  add column if not exists postal_service_code text null,
  add column if not exists postal_service_name text null,
  add column if not exists shipping_method_requested text null,
  add column if not exists shipping_quote_status text null,
  add column if not exists shipping_quote_payload jsonb not null default '{}'::jsonb,
  add column if not exists shipping_label_status text not null default 'not_printed',
  add column if not exists invoice_status text not null default 'not_printed',
  add column if not exists pick_list_status text not null default 'not_printed',
  add column if not exists is_parked boolean not null default false,
  add column if not exists is_locked boolean not null default false,
  add column if not exists parked_reason text null,
  add column if not exists locked_reason text null,
  add column if not exists identifiers jsonb not null default '[]'::jsonb,
  add column if not exists tags text[] not null default '{}',
  add column if not exists notes_count integer not null default 0,
  add column if not exists processing_notes_count integer not null default 0,
  add column if not exists merge_group_key text null,
  add column if not exists split_parent_order_id uuid null references public.loopbase_orders(id) on delete set null,
  add column if not exists assigned_picker_staff_id uuid null references public.staff_users(id) on delete set null,
  add column if not exists pickwave_id uuid null,
  add column if not exists pick_claimed_at timestamp with time zone null,
  add column if not exists packed_at timestamp with time zone null,
  add column if not exists tracking_number text null,
  add column if not exists tracking_carrier text null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'loopbase_orders_shipping_label_status_check'
      and conrelid = 'public.loopbase_orders'::regclass
  ) then
    alter table public.loopbase_orders drop constraint loopbase_orders_shipping_label_status_check;
  end if;

  alter table public.loopbase_orders
    add constraint loopbase_orders_shipping_label_status_check
    check (shipping_label_status in ('not_printed', 'queued', 'printed', 'failed', 'voided'));

  if exists (
    select 1
    from pg_constraint
    where conname = 'loopbase_orders_invoice_status_check'
      and conrelid = 'public.loopbase_orders'::regclass
  ) then
    alter table public.loopbase_orders drop constraint loopbase_orders_invoice_status_check;
  end if;

  alter table public.loopbase_orders
    add constraint loopbase_orders_invoice_status_check
    check (invoice_status in ('not_printed', 'queued', 'printed', 'failed'));

  if exists (
    select 1
    from pg_constraint
    where conname = 'loopbase_orders_pick_list_status_check'
      and conrelid = 'public.loopbase_orders'::regclass
  ) then
    alter table public.loopbase_orders drop constraint loopbase_orders_pick_list_status_check;
  end if;

  alter table public.loopbase_orders
    add constraint loopbase_orders_pick_list_status_check
    check (pick_list_status in ('not_printed', 'queued', 'printed', 'failed'));
end $$;

create index if not exists loopbase_orders_company_open_location_idx
on public.loopbase_orders (company_id, order_location_name, order_status, ordered_at desc);

create index if not exists loopbase_orders_company_pick_status_idx
on public.loopbase_orders (company_id, order_status, assigned_picker_staff_id, pickwave_id);

create index if not exists loopbase_orders_company_identifiers_idx
on public.loopbase_orders using gin (identifiers);

create index if not exists loopbase_orders_company_tags_idx
on public.loopbase_orders using gin (tags);

create unique index if not exists loopbase_orders_account_number_unique
on public.loopbase_orders (loopbase_account_id, loopbase_order_number)
where loopbase_account_id is not null and loopbase_order_number is not null;

create table if not exists public.loopbase_order_account_sequences (
  account_user_id uuid primary key references auth.users(id) on delete cascade,
  next_order_number bigint not null default 1,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.open_order_symbol_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  symbol_key text not null,
  icon text not null default 'custom',
  colour text null,
  condition jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint open_order_symbol_rules_company_key_unique unique (company_id, symbol_key)
);

create table if not exists public.open_order_views (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  view_key text not null,
  is_default boolean not null default false,
  location_name text null,
  filters jsonb not null default '{}'::jsonb,
  sorting jsonb not null default '[{"key":"ordered_at","direction":"desc"}]'::jsonb,
  columns jsonb not null default '[]'::jsonb,
  hot_buttons jsonb not null default '[]'::jsonb,
  created_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint open_order_views_company_key_unique unique (company_id, view_key)
);

create table if not exists public.loopbase_order_identifiers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null references public.loopbase_orders(id) on delete cascade,
  identifier_key text not null,
  label text not null,
  colour text null,
  icon text null,
  source text null,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint loopbase_order_identifiers_company_order_key_unique unique (company_id, order_id, identifier_key)
);

create table if not exists public.loopbase_order_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null references public.loopbase_orders(id) on delete cascade,
  note text not null,
  is_internal boolean not null default true,
  is_processing_note boolean not null default false,
  created_by_staff_id uuid null references public.staff_users(id) on delete set null,
  created_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.loopbase_pickwaves (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  pickwave_number bigint generated by default as identity,
  name text null,
  location_name text null,
  grouping_type text not null default 'items',
  sorting_type text not null default 'bin_priority',
  status text not null default 'to_pick',
  assigned_staff_id uuid null references public.staff_users(id) on delete set null,
  claimed_by_staff_id uuid null references public.staff_users(id) on delete set null,
  started_at timestamp with time zone null,
  completed_at timestamp with time zone null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint loopbase_pickwaves_grouping_type_check check (grouping_type in ('items', 'orders')),
  constraint loopbase_pickwaves_sorting_type_check check (sorting_type in ('bin_priority', 'order_view')),
  constraint loopbase_pickwaves_status_check check (status in ('to_pick', 'picking', 'packing', 'complete', 'cancelled'))
);

create table if not exists public.loopbase_pickwave_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  pickwave_id uuid not null references public.loopbase_pickwaves(id) on delete cascade,
  order_id uuid not null references public.loopbase_orders(id) on delete cascade,
  order_line_id uuid null references public.loopbase_order_lines(id) on delete cascade,
  item_id uuid null references public.items(id) on delete set null,
  sku text not null,
  quantity_to_pick numeric not null default 1,
  quantity_picked numeric not null default 0,
  source_location_name text null,
  source_bin_code text null,
  route_sort_key text null,
  status text not null default 'to_pick',
  claimed_by_staff_id uuid null references public.staff_users(id) on delete set null,
  claimed_at timestamp with time zone null,
  picked_at timestamp with time zone null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint loopbase_pickwave_items_status_check check (status in ('to_pick', 'picking', 'picked', 'short', 'cancelled'))
);

create index if not exists open_order_views_company_default_idx
on public.open_order_views (company_id, is_default, updated_at desc);

create index if not exists loopbase_order_identifiers_company_order_idx
on public.loopbase_order_identifiers (company_id, order_id, is_active);

create index if not exists loopbase_order_notes_company_order_idx
on public.loopbase_order_notes (company_id, order_id, created_at desc);

create index if not exists loopbase_pickwaves_company_status_idx
on public.loopbase_pickwaves (company_id, status, updated_at desc);

create index if not exists loopbase_pickwave_items_company_status_idx
on public.loopbase_pickwave_items (company_id, status, route_sort_key);

create index if not exists open_order_symbol_rules_company_active_idx
on public.open_order_symbol_rules (company_id, is_active, sort_order);

alter table public.open_order_views enable row level security;
alter table public.loopbase_order_identifiers enable row level security;
alter table public.loopbase_order_notes enable row level security;
alter table public.loopbase_pickwaves enable row level security;
alter table public.loopbase_pickwave_items enable row level security;
alter table public.loopbase_order_account_sequences enable row level security;
alter table public.open_order_symbol_rules enable row level security;

drop policy if exists "loopbase tenant read open_order_views" on public.open_order_views;
drop policy if exists "loopbase tenant manage open_order_views" on public.open_order_views;
drop policy if exists "loopbase tenant read loopbase_order_identifiers" on public.loopbase_order_identifiers;
drop policy if exists "loopbase tenant manage loopbase_order_identifiers" on public.loopbase_order_identifiers;
drop policy if exists "loopbase tenant read loopbase_order_notes" on public.loopbase_order_notes;
drop policy if exists "loopbase tenant manage loopbase_order_notes" on public.loopbase_order_notes;
drop policy if exists "loopbase tenant read loopbase_pickwaves" on public.loopbase_pickwaves;
drop policy if exists "loopbase tenant manage loopbase_pickwaves" on public.loopbase_pickwaves;
drop policy if exists "loopbase tenant read loopbase_pickwave_items" on public.loopbase_pickwave_items;
drop policy if exists "loopbase tenant manage loopbase_pickwave_items" on public.loopbase_pickwave_items;
drop policy if exists "loopbase account manage own order sequences" on public.loopbase_order_account_sequences;
drop policy if exists "loopbase tenant read open_order_symbol_rules" on public.open_order_symbol_rules;
drop policy if exists "loopbase tenant manage open_order_symbol_rules" on public.open_order_symbol_rules;

create policy "loopbase tenant read open_order_views"
on public.open_order_views for select to authenticated
using (public.loopbase_user_can_read_company(company_id));

create policy "loopbase tenant manage open_order_views"
on public.open_order_views for all to authenticated
using (public.loopbase_user_can_write_company(company_id))
with check (public.loopbase_user_can_write_company(company_id));

create policy "loopbase tenant read loopbase_order_identifiers"
on public.loopbase_order_identifiers for select to authenticated
using (public.loopbase_user_can_read_company(company_id));

create policy "loopbase tenant manage loopbase_order_identifiers"
on public.loopbase_order_identifiers for all to authenticated
using (public.loopbase_user_can_write_company(company_id))
with check (public.loopbase_user_can_write_company(company_id));

create policy "loopbase tenant read loopbase_order_notes"
on public.loopbase_order_notes for select to authenticated
using (public.loopbase_user_can_read_company(company_id));

create policy "loopbase tenant manage loopbase_order_notes"
on public.loopbase_order_notes for all to authenticated
using (public.loopbase_user_can_write_company(company_id))
with check (public.loopbase_user_can_write_company(company_id));

create policy "loopbase tenant read loopbase_pickwaves"
on public.loopbase_pickwaves for select to authenticated
using (public.loopbase_user_can_read_company(company_id));

create policy "loopbase tenant manage loopbase_pickwaves"
on public.loopbase_pickwaves for all to authenticated
using (public.loopbase_user_can_write_company(company_id))
with check (public.loopbase_user_can_write_company(company_id));

create policy "loopbase tenant read loopbase_pickwave_items"
on public.loopbase_pickwave_items for select to authenticated
using (public.loopbase_user_can_read_company(company_id));

create policy "loopbase tenant manage loopbase_pickwave_items"
on public.loopbase_pickwave_items for all to authenticated
using (public.loopbase_user_can_write_company(company_id))
with check (public.loopbase_user_can_write_company(company_id));

create policy "loopbase account manage own order sequences"
on public.loopbase_order_account_sequences for all to authenticated
using (account_user_id = auth.uid())
with check (account_user_id = auth.uid());

create policy "loopbase tenant read open_order_symbol_rules"
on public.open_order_symbol_rules for select to authenticated
using (public.loopbase_user_can_read_company(company_id));

create policy "loopbase tenant manage open_order_symbol_rules"
on public.open_order_symbol_rules for all to authenticated
using (public.loopbase_user_can_write_company(company_id))
with check (public.loopbase_user_can_write_company(company_id));

create or replace function public.loopbase_order_account_for_company(target_company_id uuid)
returns uuid
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (
      select c.created_by_user_id
      from public.companies c
      where c.id = target_company_id
    ),
    (
      select cm.user_id
      from public.company_memberships cm
      where cm.company_id = target_company_id
        and cm.status = 'active'
        and cm.role in ('owner', 'admin')
      order by
        case cm.role when 'owner' then 0 else 1 end,
        cm.created_at,
        cm.id
      limit 1
    )
  );
$$;

create or replace function public.loopbase_next_order_number(target_account_user_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  reserved_number bigint;
begin
  if target_account_user_id is null then
    return null;
  end if;

  insert into public.loopbase_order_account_sequences (account_user_id, next_order_number)
  values (target_account_user_id, 2)
  on conflict (account_user_id)
  do update set
    next_order_number = public.loopbase_order_account_sequences.next_order_number + 1,
    updated_at = now()
  returning next_order_number - 1 into reserved_number;

  return reserved_number;
end;
$$;

create or replace function public.loopbase_assign_order_number_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.loopbase_account_id is null then
    new.loopbase_account_id := public.loopbase_order_account_for_company(new.company_id);
  end if;

  if new.loopbase_order_number is null and new.loopbase_account_id is not null then
    new.loopbase_order_number := public.loopbase_next_order_number(new.loopbase_account_id);
  end if;

  return new;
end;
$$;

drop trigger if exists loopbase_orders_assign_number_before_insert on public.loopbase_orders;

create trigger loopbase_orders_assign_number_before_insert
before insert on public.loopbase_orders
for each row
execute function public.loopbase_assign_order_number_before_insert();

with account_orders as (
  select
    o.id,
    coalesce(o.loopbase_account_id, public.loopbase_order_account_for_company(o.company_id)) as account_user_id,
    row_number() over (
      partition by coalesce(o.loopbase_account_id, public.loopbase_order_account_for_company(o.company_id))
      order by coalesce(o.ordered_at, o.created_at), o.created_at, o.id
    ) as generated_order_number
  from public.loopbase_orders o
  where o.loopbase_order_number is null
),
updated_orders as (
  update public.loopbase_orders o
  set
    loopbase_account_id = account_orders.account_user_id,
    loopbase_order_number = account_orders.generated_order_number
  from account_orders
  where o.id = account_orders.id
    and account_orders.account_user_id is not null
  returning o.loopbase_account_id, o.loopbase_order_number
),
next_numbers as (
  select
    loopbase_account_id as account_user_id,
    max(loopbase_order_number) + 1 as next_order_number
  from public.loopbase_orders
  where loopbase_account_id is not null
  group by loopbase_account_id
)
insert into public.loopbase_order_account_sequences (account_user_id, next_order_number)
select account_user_id, next_order_number
from next_numbers
on conflict (account_user_id)
do update set
  next_order_number = greatest(
    public.loopbase_order_account_sequences.next_order_number,
    excluded.next_order_number
  ),
  updated_at = now();

with default_columns as (
  select '[
    {"key":"select","label":"","width":44,"visible":true},
    {"key":"company_name","label":"Company","width":135,"visible":true},
    {"key":"paid_symbol","label":"£","width":42,"visible":true},
    {"key":"invoice_symbol","label":"A4","width":42,"visible":true},
    {"key":"shipping_symbol","label":"Ship","width":48,"visible":true},
    {"key":"locked_symbol","label":"Lock","width":48,"visible":true},
    {"key":"picking_symbol","label":"Pick","width":48,"visible":true},
    {"key":"notes_symbol","label":"Notes","width":52,"visible":true},
    {"key":"external_order_number","label":"Order","width":150,"visible":true},
    {"key":"ordered_at","label":"Date","width":135,"visible":true},
    {"key":"channel","label":"Source","width":115,"visible":true},
    {"key":"buyer_name","label":"Customer","width":190,"visible":true},
    {"key":"total_amount","label":"Total","width":95,"visible":true},
    {"key":"lines","label":"Items","width":260,"visible":true},
    {"key":"order_location_name","label":"Location","width":120,"visible":true},
    {"key":"postal_service_name","label":"Shipping","width":160,"visible":true},
    {"key":"order_status","label":"Status","width":120,"visible":true},
    {"key":"pick_status","label":"Pick","width":120,"visible":true}
  ]'::jsonb as columns
),
hot_buttons as (
  select '[
    {"key":"start_pick","label":"Start Pick","action":"start_pick"},
    {"key":"print_invoice","label":"Print Invoice","action":"print_invoice"},
    {"key":"assign_shipping","label":"Assign Shipping","action":"assign_shipping"},
    {"key":"park","label":"Park","action":"park"},
    {"key":"lock","label":"Lock","action":"lock"}
  ]'::jsonb as buttons
)
insert into public.open_order_views (
  company_id,
  name,
  view_key,
  is_default,
  filters,
  sorting,
  columns,
  hot_buttons
)
select
  c.id,
  'All Open Orders',
  'all-open-orders',
  true,
  '{"statuses":["open","reserved","picking","part_picked","picked","on_hold","failed"]}'::jsonb,
  '[{"key":"ordered_at","direction":"desc"}]'::jsonb,
  default_columns.columns,
  hot_buttons.buttons
from public.companies c
cross join default_columns
cross join hot_buttons
where not exists (
  select 1
  from public.open_order_views existing
  where existing.company_id = c.id
    and existing.view_key = 'all-open-orders'
);

with default_columns as (
  select '[
    {"key":"select","label":"","width":44,"visible":true},
    {"key":"company_name","label":"Company","width":135,"visible":true},
    {"key":"paid_symbol","label":"£","width":42,"visible":true},
    {"key":"invoice_symbol","label":"A4","width":42,"visible":true},
    {"key":"shipping_symbol","label":"Ship","width":48,"visible":true},
    {"key":"locked_symbol","label":"Lock","width":48,"visible":true},
    {"key":"picking_symbol","label":"Pick","width":48,"visible":true},
    {"key":"notes_symbol","label":"Notes","width":52,"visible":true},
    {"key":"external_order_number","label":"Order","width":150,"visible":true},
    {"key":"ordered_at","label":"Date","width":135,"visible":true},
    {"key":"channel","label":"Source","width":115,"visible":true},
    {"key":"buyer_name","label":"Customer","width":190,"visible":true},
    {"key":"total_amount","label":"Total","width":95,"visible":true},
    {"key":"lines","label":"Items","width":260,"visible":true},
    {"key":"order_location_name","label":"Location","width":120,"visible":true},
    {"key":"postal_service_name","label":"Shipping","width":160,"visible":true},
    {"key":"order_status","label":"Status","width":120,"visible":true},
    {"key":"pick_status","label":"Pick","width":120,"visible":true}
  ]'::jsonb as columns
)
update public.open_order_views view
set
  columns = default_columns.columns,
  updated_at = now()
from default_columns
where view.view_key = 'all-open-orders'
  and view.columns @> '[{"key":"icons"}]'::jsonb;

update public.open_order_views view
set
  columns = jsonb_build_array(
    jsonb_build_object('key', 'select', 'label', '', 'width', 44, 'visible', true),
    jsonb_build_object('key', 'general', 'label', 'General', 'width', 315, 'visible', true),
    jsonb_build_object('key', 'buyer_name', 'label', 'Customer', 'width', 245, 'visible', true),
    jsonb_build_object('key', 'total_amount', 'label', 'Total', 'width', 125, 'visible', true),
    jsonb_build_object('key', 'lines', 'label', 'Items', 'width', 450, 'visible', true),
    jsonb_build_object('key', 'order_location_name', 'label', 'Location', 'width', 120, 'visible', false),
    jsonb_build_object('key', 'postal_service_name', 'label', 'Shipping', 'width', 160, 'visible', true),
    jsonb_build_object('key', 'order_status', 'label', 'Status', 'width', 120, 'visible', false),
    jsonb_build_object('key', 'pick_status', 'label', 'Pick', 'width', 120, 'visible', false)
  ),
  updated_at = now()
where view.view_key = 'all-open-orders'
  and (
    view.columns @> '[{"key":"icons"}]'::jsonb
    or view.columns @> '[{"key":"paid_symbol"}]'::jsonb
    or view.columns @> '[{"key":"external_order_number"}]'::jsonb
  );

commit;
