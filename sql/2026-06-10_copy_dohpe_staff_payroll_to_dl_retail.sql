-- One-off repair: make DL Retail use the same active staff/payroll setup as
-- Dohpe, excluding Sophie.
--
-- This is intentionally conservative:
-- - It does not delete staff.
-- - It backfills any legacy staff rows with null company_id to Dohpe.
-- - It removes the old global unique staff-name index if still present.
-- - It copies staff profiles into DL Retail as separate rows so each company
--   can later have different PINs, roles, payroll and holiday settings.
-- - It copies Dohpe payroll defaults into DL Retail.

begin;

drop index if exists public.staff_users_name_idx;

create unique index if not exists staff_users_company_name_active_idx
on public.staff_users (company_id, lower(trim(name)))
where is_active is true;

create unique index if not exists staff_users_company_auth_user_idx
on public.staff_users (company_id, auth_user_id)
where auth_user_id is not null;

with company_ids as (
  select
    (select id from public.companies where slug in ('dohpe', 'dohpe-stock') order by slug limit 1) as dohpe_company_id,
    (select id from public.companies where slug in ('dl-retail', 'dlretail', 'dl_retail') order by slug limit 1) as dl_retail_company_id
)
update public.staff_users su
set company_id = company_ids.dohpe_company_id
from company_ids
where su.company_id is null
  and company_ids.dohpe_company_id is not null;

with company_ids as (
  select
    (select id from public.companies where slug in ('dohpe', 'dohpe-stock') order by slug limit 1) as dohpe_company_id,
    (select id from public.companies where slug in ('dl-retail', 'dlretail', 'dl_retail') order by slug limit 1) as dl_retail_company_id
),
dohpe_staff as (
  select su.*, company_ids.dl_retail_company_id
  from public.staff_users su
  cross join company_ids
  where company_ids.dohpe_company_id is not null
    and company_ids.dl_retail_company_id is not null
    and su.company_id = company_ids.dohpe_company_id
    and lower(trim(su.name)) <> 'sophie'
)
insert into public.staff_users (
  company_id,
  auth_user_id,
  name,
  pin_code,
  is_active,
  must_change_pin,
  pin_updated_at,
  role,
  permissions,
  payroll_settings
)
select
  dohpe_staff.dl_retail_company_id,
  dohpe_staff.auth_user_id,
  dohpe_staff.name,
  dohpe_staff.pin_code,
  coalesce(dohpe_staff.is_active, true),
  coalesce(dohpe_staff.must_change_pin, false),
  dohpe_staff.pin_updated_at,
  coalesce(dohpe_staff.role, 'staff'),
  coalesce(dohpe_staff.permissions, '{}'::jsonb),
  coalesce(dohpe_staff.payroll_settings, '{}'::jsonb)
from dohpe_staff
where not exists (
  select 1
  from public.staff_users existing
  where existing.company_id = dohpe_staff.dl_retail_company_id
    and lower(trim(existing.name)) = lower(trim(dohpe_staff.name))
);

with company_ids as (
  select
    (select id from public.companies where slug in ('dohpe', 'dohpe-stock') order by slug limit 1) as dohpe_company_id,
    (select id from public.companies where slug in ('dl-retail', 'dlretail', 'dl_retail') order by slug limit 1) as dl_retail_company_id
),
dohpe_payroll as (
  select ps.*
  from public.payroll_settings ps
  cross join company_ids
  where (
      ps.company_id = company_ids.dohpe_company_id
      or (ps.company_id is null and ps.id = 'default')
    )
  order by ps.company_id nulls last
  limit 1
),
target as (
  select
    company_ids.dl_retail_company_id,
    dohpe_payroll.*
  from company_ids
  cross join dohpe_payroll
  where company_ids.dl_retail_company_id is not null
)
insert into public.payroll_settings (
  id,
  company_id,
  payroll_period,
  payroll_start_day,
  payroll_start_date,
  holiday_year_start_month,
  holiday_year_start_day,
  default_holiday_method,
  default_holiday_weeks,
  default_accrual_percent
)
select
  'default-' || left(target.dl_retail_company_id::text, 8),
  target.dl_retail_company_id,
  target.payroll_period,
  target.payroll_start_day,
  target.payroll_start_date,
  target.holiday_year_start_month,
  target.holiday_year_start_day,
  target.default_holiday_method,
  target.default_holiday_weeks,
  target.default_accrual_percent
from target
on conflict (id) do update
set
  company_id = excluded.company_id,
  payroll_period = excluded.payroll_period,
  payroll_start_day = excluded.payroll_start_day,
  payroll_start_date = excluded.payroll_start_date,
  holiday_year_start_month = excluded.holiday_year_start_month,
  holiday_year_start_day = excluded.holiday_year_start_day,
  default_holiday_method = excluded.default_holiday_method,
  default_holiday_weeks = excluded.default_holiday_weeks,
  default_accrual_percent = excluded.default_accrual_percent;

select
  c.slug as company_slug,
  su.name,
  su.role,
  su.is_active,
  su.payroll_settings
from public.staff_users su
join public.companies c on c.id = su.company_id
where c.slug in ('dohpe', 'dohpe-stock', 'dl-retail', 'dlretail', 'dl_retail')
order by c.slug, su.name;

select
  c.slug as company_slug,
  ps.payroll_period,
  ps.payroll_start_day,
  ps.holiday_year_start_month,
  ps.holiday_year_start_day
from public.payroll_settings ps
join public.companies c on c.id = ps.company_id
where c.slug in ('dohpe', 'dohpe-stock', 'dl-retail', 'dlretail', 'dl_retail')
order by c.slug;

commit;
