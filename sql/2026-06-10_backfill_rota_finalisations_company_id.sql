-- Backfill company_id on old rota finalisation rows.
--
-- Needed after moving rota/reports to the AppNav company switcher.
-- Existing finalised rows used company_key only (dohpe / dlretail), so the
-- company_id-filtered app could not see them.

begin;

with company_keys as (
  select
    id as company_id,
    case
      when lower(coalesce(slug, '') || ' ' || coalesce(name, '')) like '%dl%retail%' then 'dlretail'
      when lower(coalesce(slug, '') || ' ' || coalesce(name, '')) like '%dohpe%' then 'dohpe'
      else lower(regexp_replace(coalesce(nullif(slug, ''), name), '[^a-z0-9]+', '-', 'g'))
    end as company_key
  from public.companies
)
update public.rota_week_finalisations rwf
set
  company_id = ck.company_id,
  updated_at = now()
from company_keys ck
where rwf.company_id is null
  and rwf.company_key = ck.company_key;

select company_key, company_id, count(*) as finalised_weeks
from public.rota_week_finalisations
group by company_key, company_id
order by company_key, company_id;

commit;
