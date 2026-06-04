-- Stable location slots for SaaS installs.
-- The internal code stays fixed; the label can be changed in Settings.

alter table public.locations
add column if not exists label text;

alter table public.locations
add column if not exists bin_mode text not null default 'range';

alter table public.locations
add column if not exists basic_bins text[] not null default '{}'::text[];

alter table public.locations
drop constraint if exists locations_bin_mode_check;

alter table public.locations
add constraint locations_bin_mode_check
check (bin_mode in ('basic', 'range'));

update public.locations
set
  code = case
    when name in ('LOCATION-1', 'LOCATION-2', 'LOCATION-3', 'LOCATION-4', 'LOCATION-5') then name
    when code in ('LOCATION-1', 'LOCATION-2', 'LOCATION-3', 'LOCATION-4', 'LOCATION-5') then code
    else code
  end,
  label = coalesce(
    nullif(label, ''),
    case name
      when 'LOCATION-1' then 'WAREHOUSE'
      when 'LOCATION-2' then 'SHOP-1'
      when 'LOCATION-3' then 'SHOP-2'
      when 'LOCATION-4' then 'SHOP-3'
      when 'LOCATION-5' then 'SHOP-4'
      else label
    end
  ),
  is_active = true,
  bin_mode = coalesce(
    nullif(bin_mode, ''),
    case
      when name = 'LOCATION-1' then 'range'
      else 'basic'
    end
  ),
  basic_bins = case
    when basic_bins is null or cardinality(basic_bins) = 0 then
      case
        when name = 'LOCATION-1' then array['Default']::text[]
        else array['FLOOR', 'STOCK']::text[]
      end
    else basic_bins
  end
where name in ('LOCATION-1', 'LOCATION-2', 'LOCATION-3', 'LOCATION-4', 'LOCATION-5');

insert into public.locations (code, name, label, is_active, bin_mode, basic_bins)
select seed.name, seed.name, seed.label, true, seed.bin_mode, seed.basic_bins
from (
  values
    ('LOCATION-1', 'WAREHOUSE', 'range', array['Default']::text[]),
    ('LOCATION-2', 'SHOP-1', 'basic', array['FLOOR', 'STOCK']::text[]),
    ('LOCATION-3', 'SHOP-2', 'basic', array['FLOOR', 'STOCK']::text[]),
    ('LOCATION-4', 'SHOP-3', 'basic', array['FLOOR', 'STOCK']::text[]),
    ('LOCATION-5', 'SHOP-4', 'basic', array['FLOOR', 'STOCK']::text[])
) as seed(name, label, bin_mode, basic_bins)
where not exists (
  select 1
  from public.locations existing
  where existing.name = seed.name
);
