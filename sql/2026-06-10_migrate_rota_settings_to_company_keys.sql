-- Migrate legacy rota settings into company-scoped rota settings.
--
-- What this does:
-- - Reads old rota payloads saved under rota:<auth_user_id> and dohpe_global_rota.
-- - Splits the old combined DOHPE / DL Retail JSON into one payload per company.
-- - Writes new rows using user_key = rota:<auth_user_id>:<company_id>.
-- - Deletes the old rota:<auth_user_id> and dohpe_global_rota rows after copy.
--
-- It does not delete staff, rota finalisations, reports, items, or company data.

begin;

create temp table _rota_tenant_company_keys as
select
  c.id as company_id,
  c.name as company_name,
  case
    when lower(coalesce(c.slug, '') || ' ' || coalesce(c.name, '')) like '%dl%retail%' then 'dlretail'
    when lower(coalesce(c.slug, '') || ' ' || coalesce(c.name, '')) like '%dohpe%' then 'dohpe'
    else lower(regexp_replace(coalesce(nullif(c.slug, ''), c.name), '[^a-z0-9]+', '-', 'g'))
  end as company_key
from public.companies c
where c.id is not null;

create temp table _rota_migration_payloads as
with per_user_sources as (
  select
    substring(rs.user_key from '^rota:([0-9a-fA-F-]{36})$')::uuid as user_id,
    rs.data::jsonb as source_data,
    1 as priority
  from public.rota_settings rs
  where rs.user_key ~ '^rota:[0-9a-fA-F-]{36}$'
),
global_sources as (
  select
    cm.user_id,
    rs.data::jsonb as source_data,
    2 as priority
  from public.rota_settings rs
  join public.company_memberships cm
    on cm.status = 'active'
  where rs.user_key = 'dohpe_global_rota'
),
source_candidates as (
  select
    src.user_id,
    tc.company_id,
    tc.company_name,
    tc.company_key,
    src.source_data,
    src.priority
  from (
    select * from per_user_sources
    union all
    select * from global_sources
  ) src
  join public.company_memberships cm
    on cm.user_id = src.user_id
   and cm.status = 'active'
  join _rota_tenant_company_keys tc
    on tc.company_id = cm.company_id
),
ranked as (
  select
    *,
    row_number() over (
      partition by user_id, company_id
      order by priority
    ) as source_rank
  from source_candidates
),
scoped as (
  select
    user_id,
    company_id,
    company_key,
    jsonb_build_object(
      'companies',
      jsonb_build_array(
        coalesce(
          (
            select
              company_row
              || jsonb_build_object(
                'key', ranked.company_key,
                'name', ranked.company_name
              )
            from jsonb_array_elements(coalesce(ranked.source_data->'companies', '[]'::jsonb)) company_row
            where company_row->>'key' = ranked.company_key
            limit 1
          ),
          jsonb_build_object(
            'key', ranked.company_key,
            'name', ranked.company_name,
            'telegramGroup', ranked.company_name || ' rota group',
            'logoUrl', ''
          )
        )
      ),
      'staff', coalesce(ranked.source_data->'staff', '[]'::jsonb),
      'openingTimes', jsonb_build_object(
        ranked.company_key,
        coalesce(ranked.source_data->'openingTimes'->ranked.company_key, '[]'::jsonb)
      ),
      'rota', jsonb_build_object(
        ranked.company_key,
        coalesce(ranked.source_data->'rota'->ranked.company_key, '{}'::jsonb)
      ),
      'defaultRota', jsonb_build_object(
        ranked.company_key,
        coalesce(ranked.source_data->'defaultRota'->ranked.company_key, '{}'::jsonb)
      ),
      'editedWeeks', jsonb_build_object(
        ranked.company_key,
        coalesce(ranked.source_data->'editedWeeks'->ranked.company_key, '{}'::jsonb)
      ),
      'closedDays', jsonb_build_object(
        ranked.company_key,
        coalesce(ranked.source_data->'closedDays'->ranked.company_key, '{}'::jsonb)
      ),
      'weeklyReports',
      coalesce(
        (
          select jsonb_agg(report_row)
          from jsonb_array_elements(coalesce(ranked.source_data->'weeklyReports', '[]'::jsonb)) report_row
          where report_row->>'company' = ranked.company_key
        ),
        '[]'::jsonb
      )
    ) as new_data
  from ranked
  where source_rank = 1
)
select
  'rota:' || user_id::text || ':' || company_id::text as user_key,
  company_id,
  company_key,
  new_data
from scoped;

insert into public.rota_settings (user_key, company_id, data, updated_at)
select user_key, company_id, new_data, now()
from _rota_migration_payloads
on conflict (user_key) do update
set
  company_id = excluded.company_id,
  data = excluded.data,
  updated_at = now();

-- Preview what was migrated in the Supabase SQL result.
select user_key, company_id, company_key
from _rota_migration_payloads
order by company_key, user_key;

delete from public.rota_settings
where user_key = 'dohpe_global_rota'
   or user_key ~ '^rota:[0-9a-fA-F-]{36}$';

commit;
