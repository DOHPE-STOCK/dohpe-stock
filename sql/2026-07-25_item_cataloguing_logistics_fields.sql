-- Item cataloguing/logistics fields for faster SKU editing and future
-- marketplace/order/shipping integrations.
-- Safe: adds nullable/defaulted columns only. Does not alter stock logic.

alter table public.items
  add column if not exists marketplace_tags text[] not null default '{}',
  add column if not exists hs_code text,
  add column if not exists country_of_origin text,
  add column if not exists composition text,
  add column if not exists extended_properties jsonb not null default '{}'::jsonb,
  add column if not exists shipping_size_identifier text,
  add column if not exists package_length_cm numeric,
  add column if not exists package_width_cm numeric,
  add column if not exists package_height_cm numeric,
  add column if not exists package_weight_grams numeric,
  add column if not exists vat_rule text not null default 'channel_default',
  add column if not exists vat_rate numeric,
  add column if not exists parent_item_id uuid null references public.items(id) on delete set null,
  add column if not exists variation_group_key text,
  add column if not exists variation_options jsonb not null default '{}'::jsonb,
  add column if not exists item_kind text not null default 'standard';

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'items_item_kind_check'
      and conrelid = 'public.items'::regclass
  ) then
    alter table public.items drop constraint items_item_kind_check;
  end if;

  alter table public.items
    add constraint items_item_kind_check
    check (item_kind in ('standard', 'parent', 'variation_child', 'composite'));

  if exists (
    select 1
    from pg_constraint
    where conname = 'items_vat_rule_check'
      and conrelid = 'public.items'::regclass
  ) then
    alter table public.items drop constraint items_vat_rule_check;
  end if;

  alter table public.items
    add constraint items_vat_rule_check
    check (vat_rule in ('channel_default', 'standard', 'zero', 'exempt', 'custom'));
end $$;

create index if not exists items_company_parent_item_idx
on public.items (company_id, parent_item_id);

create index if not exists items_company_variation_group_idx
on public.items (company_id, variation_group_key)
where variation_group_key is not null and trim(variation_group_key) <> '';

create index if not exists items_company_marketplace_tags_idx
on public.items using gin (marketplace_tags);

create table if not exists public.item_composition_components (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  composite_item_id uuid not null references public.items(id) on delete cascade,
  component_item_id uuid not null references public.items(id) on delete restrict,
  quantity numeric not null default 1,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint item_composition_components_quantity_check check (quantity > 0),
  constraint item_composition_components_unique unique (company_id, composite_item_id, component_item_id)
);

create index if not exists item_composition_components_company_composite_idx
on public.item_composition_components (company_id, composite_item_id);

create table if not exists public.company_custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  field_key text not null,
  label text not null,
  field_type text not null default 'text',
  applies_to_categories text[] not null default '{}',
  marketplace_mapping jsonb not null default '{}'::jsonb,
  is_required boolean not null default false,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint company_custom_field_definitions_type_check
    check (field_type in ('text', 'number', 'boolean', 'date', 'select', 'multi_select', 'url', 'json')),
  constraint company_custom_field_definitions_unique_key unique (company_id, field_key)
);

create table if not exists public.item_custom_field_values (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  field_definition_id uuid not null references public.company_custom_field_definitions(id) on delete cascade,
  value_text text,
  value_number numeric,
  value_boolean boolean,
  value_date date,
  value_json jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint item_custom_field_values_unique unique (company_id, item_id, field_definition_id)
);

alter table public.item_composition_components enable row level security;
alter table public.company_custom_field_definitions enable row level security;
alter table public.item_custom_field_values enable row level security;

drop policy if exists "loopbase tenant read item_composition_components" on public.item_composition_components;
drop policy if exists "loopbase tenant manage item_composition_components" on public.item_composition_components;
drop policy if exists "loopbase tenant read company_custom_field_definitions" on public.company_custom_field_definitions;
drop policy if exists "loopbase tenant manage company_custom_field_definitions" on public.company_custom_field_definitions;
drop policy if exists "loopbase tenant read item_custom_field_values" on public.item_custom_field_values;
drop policy if exists "loopbase tenant manage item_custom_field_values" on public.item_custom_field_values;

create policy "loopbase tenant read item_composition_components"
on public.item_composition_components
for select
to authenticated
using (public.loopbase_user_can_read_company(company_id));

create policy "loopbase tenant manage item_composition_components"
on public.item_composition_components
for all
to authenticated
using (public.loopbase_user_can_write_company(company_id))
with check (public.loopbase_user_can_write_company(company_id));

create policy "loopbase tenant read company_custom_field_definitions"
on public.company_custom_field_definitions
for select
to authenticated
using (public.loopbase_user_can_read_company(company_id));

create policy "loopbase tenant manage company_custom_field_definitions"
on public.company_custom_field_definitions
for all
to authenticated
using (public.loopbase_user_can_write_company(company_id))
with check (public.loopbase_user_can_write_company(company_id));

create policy "loopbase tenant read item_custom_field_values"
on public.item_custom_field_values
for select
to authenticated
using (public.loopbase_user_can_read_company(company_id));

create policy "loopbase tenant manage item_custom_field_values"
on public.item_custom_field_values
for all
to authenticated
using (public.loopbase_user_can_write_company(company_id))
with check (public.loopbase_user_can_write_company(company_id));
