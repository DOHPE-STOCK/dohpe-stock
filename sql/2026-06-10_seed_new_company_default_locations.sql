-- Seed default locations for companies that do not have any location rows yet.
--
-- This intentionally does not update existing locations, so current DOHPE /
-- DL Retail display names are left alone.

begin;

create temp table _companies_without_locations as
select c.id
from public.companies c
where not exists (
  select 1
  from public.locations l
  where l.company_id = c.id
);

with defaults(location_name, label, bin_mode, basic_bins) as (
  values
    ('LOCATION-1', 'Default', 'range', array['Default']::text[]),
    ('LOCATION-2', 'Default', 'basic', array['FLOOR', 'STOCK']::text[]),
    ('LOCATION-3', 'Default', 'basic', array['FLOOR', 'STOCK']::text[]),
    ('LOCATION-4', 'Default', 'basic', array['FLOOR', 'STOCK']::text[]),
    ('LOCATION-5', 'Default', 'basic', array['FLOOR', 'STOCK']::text[])
)
insert into public.locations (
  company_id,
  code,
  name,
  label,
  is_active,
  bin_mode,
  basic_bins
)
select
  cwl.id,
  d.location_name,
  d.location_name,
  d.label,
  true,
  d.bin_mode,
  d.basic_bins
from _companies_without_locations cwl
cross join defaults d
on conflict do nothing;

select c.name, l.name, l.label, l.bin_mode
from public.locations l
join public.companies c on c.id = l.company_id
where c.id in (select id from _companies_without_locations)
order by c.name, l.name;

commit;
