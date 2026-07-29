-- Per-location quarantine bin names.
--
-- Quarantine is a bin/state inside a location, not a separate location.
-- Quarantine bins remain pickable so stock can be moved after repair/review,
-- but they are not sellable and should reduce available stock later.

begin;

alter table public.locations
  add column if not exists quarantine_bin_code text not null default 'QUARANTINE';

update public.locations
set quarantine_bin_code = coalesce(nullif(trim(quarantine_bin_code), ''), 'QUARANTINE');

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
  coalesce(nullif(trim(l.quarantine_bin_code), ''), 'QUARANTINE'),
  coalesce(nullif(trim(l.quarantine_bin_code), ''), 'QUARANTINE'),
  coalesce(nullif(trim(l.quarantine_bin_code), ''), 'QUARANTINE'),
  'quarantine',
  false,
  false,
  true,
  l.is_active,
  now()
from public.locations l
where l.company_id is not null
on conflict (company_id, location_name, bin_code) do update
set
  display_name = excluded.display_name,
  bin_type = 'quarantine',
  is_floor = false,
  is_sellable = false,
  is_pickable = true,
  is_active = excluded.is_active,
  updated_at = now();

create index if not exists warehouse_bins_company_quarantine_idx
on public.warehouse_bins (company_id, location_name, bin_type)
where bin_type = 'quarantine';

select
  c.slug,
  l.name,
  l.label,
  l.quarantine_bin_code,
  wb.bin_code,
  wb.bin_type,
  wb.is_sellable,
  wb.is_pickable
from public.locations l
join public.companies c on c.id = l.company_id
left join public.warehouse_bins wb
  on wb.company_id = l.company_id
 and wb.location_name = l.name
 and wb.bin_code = l.quarantine_bin_code
where c.slug in ('dohpe', 'dl-retail', 'parapeak')
order by c.slug, l.sort_order nulls last, l.name;

commit;
