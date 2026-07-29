-- Location/bin model foundation for SaaS stock handling.
--
-- This is intentionally additive. The existing bin_mode/basic_bins columns stay
-- in place so current POS, transfer, Linnworks and queue logic keeps working
-- while the app moves toward a cleaner location/bin model.

begin;

alter table public.locations
  add column if not exists location_type text not null default 'stock',
  add column if not exists is_retail boolean not null default false,
  add column if not exists floor_bin_code text null,
  add column if not exists default_receiving_bin text not null default 'Default',
  add column if not exists is_default_receiving boolean not null default false,
  add column if not exists sort_order integer null,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'locations_location_type_check'
  ) then
    alter table public.locations drop constraint locations_location_type_check;
  end if;

  alter table public.locations
    add constraint locations_location_type_check
    check (location_type in ('stock', 'virtual'));
end $$;

alter table public.warehouse_bins
  add column if not exists display_name text null,
  add column if not exists bin_type text not null default 'stock',
  add column if not exists is_floor boolean not null default false,
  add column if not exists is_sellable boolean not null default true,
  add column if not exists is_pickable boolean not null default true,
  add column if not exists quarantine_reason text null,
  add column if not exists updated_at timestamp with time zone default now();

-- Make these full unique indexes, not partial indexes, so Supabase/PostgREST
-- upsert can use them with onConflict column lists.
drop index if exists public.locations_company_code_unique_idx;
drop index if exists public.locations_company_name_unique_idx;
drop index if exists public.warehouse_bins_company_location_bin_unique;

create unique index if not exists locations_company_code_unique_idx
on public.locations (company_id, code);

create unique index if not exists locations_company_name_unique_idx
on public.locations (company_id, name);

create unique index if not exists warehouse_bins_company_location_bin_unique
on public.warehouse_bins (company_id, location_name, bin_code);

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'warehouse_bins_bin_type_check'
  ) then
    alter table public.warehouse_bins drop constraint warehouse_bins_bin_type_check;
  end if;

  alter table public.warehouse_bins
    add constraint warehouse_bins_bin_type_check
    check (bin_type in ('stock', 'default', 'floor', 'quarantine', 'virtual'));
end $$;

update public.locations
set
  sort_order = coalesce(
    sort_order,
    case
      when name ~ '^LOCATION-[0-9]+$' then split_part(name, '-', 2)::integer
      else 999
    end
  ),
  is_retail = case
    when is_retail then true
    when exists (
      select 1
      from unnest(coalesce(basic_bins, '{}'::text[])) as bin(value)
      where upper(trim(bin.value)) = 'FLOOR'
    ) then true
    else false
  end,
  floor_bin_code = case
    when floor_bin_code is not null and trim(floor_bin_code) <> '' then trim(floor_bin_code)
    when exists (
      select 1
      from unnest(coalesce(basic_bins, '{}'::text[])) as bin(value)
      where upper(trim(bin.value)) = 'FLOOR'
    ) then 'FLOOR'
    else floor_bin_code
  end,
  default_receiving_bin = coalesce(nullif(trim(default_receiving_bin), ''), 'Default');

with ranked as (
  select
    id,
    row_number() over (
      partition by company_id
      order by
        case when name = 'LOCATION-1' then 0 else 1 end,
        coalesce(sort_order, 999),
        created_at nulls last,
        id::text
    ) as rn
  from public.locations
  where is_active is true
)
update public.locations l
set is_default_receiving = ranked.rn = 1
from ranked
where ranked.id = l.id
  and coalesce(l.is_default_receiving, false) is distinct from (ranked.rn = 1);

drop index if exists public.locations_one_default_receiving_per_company_idx;
create unique index if not exists locations_one_default_receiving_per_company_idx
on public.locations (company_id)
where is_default_receiving is true;

insert into public.warehouse_bins (
  company_id,
  location_name,
  bin_code,
  label,
  display_name,
  bin_type,
  is_floor,
  is_sellable,
  is_pickable,
  is_active,
  updated_at
)
select
  l.company_id,
  l.name,
  'Default',
  'Default',
  'Default',
  'default',
  false,
  true,
  true,
  true,
  now()
from public.locations l
where l.company_id is not null
on conflict (company_id, location_name, bin_code) do update
set
  display_name = coalesce(public.warehouse_bins.display_name, excluded.display_name),
  bin_type = case
    when public.warehouse_bins.bin_type = 'stock' then excluded.bin_type
    else public.warehouse_bins.bin_type
  end,
  is_pickable = true,
  updated_at = now();

insert into public.warehouse_bins (
  company_id,
  location_name,
  bin_code,
  label,
  display_name,
  bin_type,
  is_floor,
  is_sellable,
  is_pickable,
  is_active,
  updated_at
)
select
  l.company_id,
  l.name,
  coalesce(nullif(trim(l.floor_bin_code), ''), 'FLOOR'),
  coalesce(nullif(trim(l.floor_bin_code), ''), 'FLOOR'),
  coalesce(nullif(trim(l.floor_bin_code), ''), 'FLOOR'),
  'floor',
  true,
  true,
  true,
  true,
  now()
from public.locations l
where l.company_id is not null
  and l.is_retail is true
on conflict (company_id, location_name, bin_code) do update
set
  bin_type = 'floor',
  is_floor = true,
  is_sellable = true,
  is_pickable = true,
  is_active = true,
  updated_at = now();

create index if not exists locations_company_active_sort_idx
on public.locations (company_id, is_active, sort_order, name);

create index if not exists warehouse_bins_company_location_type_idx
on public.warehouse_bins (company_id, location_name, bin_type, is_active);

select
  c.slug,
  l.name,
  l.label,
  l.is_active,
  l.is_retail,
  l.floor_bin_code,
  l.is_default_receiving,
  count(wb.id) filter (where wb.is_active is true) as active_bin_count
from public.locations l
join public.companies c on c.id = l.company_id
left join public.warehouse_bins wb
  on wb.company_id = l.company_id
 and wb.location_name = l.name
where c.slug in ('dohpe', 'dl-retail', 'parapeak')
group by c.slug, l.id
order by c.slug, l.sort_order nulls last, l.name;

commit;
