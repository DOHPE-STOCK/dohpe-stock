-- Repair finalised rota history that was saved with legacy rota-only staff IDs
-- such as staff-1/staff-2 instead of public.staff_users.id UUIDs.
--
-- Safe intent:
-- - Builds a temporary legacy -> real staff ID map from finalised shift staffName values.
-- - Rewrites totals.shifts[*].staffId when a matching staff_users.name exists.
-- - Rekeys totals.staffTotals from legacy IDs to real staff UUIDs where a mapping exists.
-- - Rekeys older top-level totals objects from legacy IDs to real staff UUIDs.
-- - Does not delete rows or change hours/wages.
-- - Ensures RLS is enabled for rota finalisation/payroll settings tables.

begin;

alter table public.rota_week_finalisations enable row level security;
alter table public.payroll_settings enable row level security;

drop policy if exists "authenticated full access rota_week_finalisations"
on public.rota_week_finalisations;

create policy "authenticated full access rota_week_finalisations"
on public.rota_week_finalisations
for all
to authenticated
using (true)
with check (true);

drop policy if exists "authenticated full access payroll_settings"
on public.payroll_settings;

create policy "authenticated full access payroll_settings"
on public.payroll_settings
for all
to authenticated
using (true)
with check (true);

create temp table _rota_staff_id_repair_map as
with shift_names as (
  select distinct
    shift->>'staffId' as legacy_staff_id,
    lower(regexp_replace(trim(shift->>'staffName'), '[[:space:]]+', ' ', 'g')) as staff_name_key
  from public.rota_week_finalisations rwf
  cross join lateral jsonb_array_elements(coalesce(rwf.totals->'shifts', '[]'::jsonb)) shift
  where shift->>'staffId' like 'staff-%'
    and coalesce(shift->>'staffName', '') <> ''
),
staff_matches as (
  select
    sn.legacy_staff_id,
    su.id::text as real_staff_id,
    su.name as real_staff_name,
    row_number() over (
      partition by sn.legacy_staff_id
      order by su.is_active desc nulls last, su.name
    ) as match_rank
  from shift_names sn
  join public.staff_users su
    on lower(regexp_replace(trim(su.name), '[[:space:]]+', ' ', 'g')) = sn.staff_name_key
)
select legacy_staff_id, real_staff_id, real_staff_name
from staff_matches
where match_rank = 1;

-- Preview the mapping in Supabase SQL results before the update output.
select *
from _rota_staff_id_repair_map
order by legacy_staff_id;

with repaired as (
  select
    rwf.id,
    case
      when rwf.totals ? 'shifts' then
        jsonb_set(
          rwf.totals,
          '{shifts}',
          (
            select coalesce(
              jsonb_agg(
                case
                  when map.real_staff_id is null then shift
                  else jsonb_set(shift, '{staffId}', to_jsonb(map.real_staff_id), true)
                end
                order by ordinality
              ),
              '[]'::jsonb
            )
            from jsonb_array_elements(coalesce(rwf.totals->'shifts', '[]'::jsonb))
              with ordinality as shifts(shift, ordinality)
            left join _rota_staff_id_repair_map map
              on map.legacy_staff_id = shift->>'staffId'
          ),
          true
        )
      else rwf.totals
    end as totals_with_shifts
  from public.rota_week_finalisations rwf
),
rekeyed as (
  select
    repaired.id,
    case
      when repaired.totals_with_shifts ? 'staffTotals' then
        jsonb_set(
          repaired.totals_with_shifts,
          '{staffTotals}',
          (
            select coalesce(
              jsonb_object_agg(coalesce(map.real_staff_id, entry.key), entry.value),
              '{}'::jsonb
            )
            from jsonb_each(coalesce(repaired.totals_with_shifts->'staffTotals', '{}'::jsonb)) entry
            left join _rota_staff_id_repair_map map
              on map.legacy_staff_id = entry.key
          ),
          true
        )
      else repaired.totals_with_shifts
    end as repaired_totals
  from repaired
),
top_level_rekeyed as (
  select
    rekeyed.id,
    case
      when rekeyed.repaired_totals ? 'staffTotals'
        or rekeyed.repaired_totals ? 'shifts'
        or not exists (
          select 1
          from jsonb_each(rekeyed.repaired_totals) entry
          where entry.key like 'staff-%'
        )
      then rekeyed.repaired_totals
      else (
        select coalesce(
          jsonb_object_agg(coalesce(map.real_staff_id, entry.key), entry.value),
          '{}'::jsonb
        )
        from jsonb_each(rekeyed.repaired_totals) entry
        left join _rota_staff_id_repair_map map
          on map.legacy_staff_id = entry.key
      )
    end as repaired_totals
  from rekeyed
)
update public.rota_week_finalisations rwf
set
  totals = top_level_rekeyed.repaired_totals,
  updated_at = now()
from top_level_rekeyed
where rwf.id = top_level_rekeyed.id
  and rwf.totals is distinct from top_level_rekeyed.repaired_totals;

-- Check for anything still using legacy staff IDs after the repair.
select 'remaining shift legacy refs' as check_name,
  rwf.company_key,
  rwf.week_id,
  shift->>'staffId' as remaining_staff_id,
  shift->>'staffName' as remaining_staff_name
from public.rota_week_finalisations rwf
cross join lateral jsonb_array_elements(coalesce(rwf.totals->'shifts', '[]'::jsonb)) shift
where shift->>'staffId' like 'staff-%'
order by rwf.week_id desc, rwf.company_key;

select 'remaining totals legacy refs' as check_name,
  rwf.company_key,
  rwf.week_id,
  entry.key as remaining_staff_id
from public.rota_week_finalisations rwf
cross join lateral jsonb_each(
  case
    when rwf.totals ? 'staffTotals' then rwf.totals->'staffTotals'
    when rwf.totals ? 'shifts' then '{}'::jsonb
    else rwf.totals
  end
) entry
where entry.key like 'staff-%'
order by rwf.week_id desc, rwf.company_key;

commit;
