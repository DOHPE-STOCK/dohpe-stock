-- Company-scoped staff repair for SaaS readiness.
--
-- Intent:
-- - Staff display names can repeat across companies.
-- - Staff/PIN/payroll/permissions remain separate per company.
-- - Copy the current Dohpe staff list into DL Retail, excluding Sophie.
-- - Future owner/admin company memberships get a default staff profile that can
--   later be renamed and assigned a real PIN without breaking historical links.

begin;

drop index if exists public.staff_users_name_idx;

create unique index if not exists staff_users_company_name_active_idx
on public.staff_users (company_id, lower(trim(name)))
where is_active is true;

create unique index if not exists staff_users_company_auth_user_idx
on public.staff_users (company_id, auth_user_id)
where auth_user_id is not null;

with companies as (
  select
    (select id from public.companies where slug = 'dohpe' limit 1) as dohpe_company_id,
    (select id from public.companies where slug = 'dl-retail' limit 1) as dl_retail_company_id
),
source_staff as (
  select
    su.*,
    c.dl_retail_company_id
  from public.staff_users su
  cross join companies c
  where su.company_id = c.dohpe_company_id
    and c.dl_retail_company_id is not null
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
  source_staff.dl_retail_company_id,
  source_staff.auth_user_id,
  source_staff.name,
  source_staff.pin_code,
  coalesce(source_staff.is_active, true),
  coalesce(source_staff.must_change_pin, false),
  source_staff.pin_updated_at,
  coalesce(source_staff.role, 'staff'),
  coalesce(source_staff.permissions, '{}'::jsonb),
  coalesce(source_staff.payroll_settings, '{}'::jsonb)
from source_staff
where not exists (
  select 1
  from public.staff_users existing
  where existing.company_id = source_staff.dl_retail_company_id
    and lower(trim(existing.name)) = lower(trim(source_staff.name))
);

create or replace function public.ensure_membership_staff_profile()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  user_email text;
  user_name text;
  final_name text;
  suffix integer := 2;
begin
  if new.status is distinct from 'active' then
    return new;
  end if;

  if coalesce(new.role, '') not in ('owner', 'admin') then
    return new;
  end if;

  if exists (
    select 1
    from public.staff_users su
    where su.company_id = new.company_id
      and su.auth_user_id = new.user_id
  ) then
    return new;
  end if;

  select
    au.email,
    coalesce(
      nullif(trim(au.raw_user_meta_data->>'name'), ''),
      nullif(trim(au.raw_user_meta_data->>'full_name'), ''),
      nullif(trim(split_part(au.email, '@', 1)), ''),
      'Owner'
    )
  into user_email, user_name
  from auth.users au
  where au.id = new.user_id;

  final_name := coalesce(user_name, 'Owner');

  while exists (
    select 1
    from public.staff_users su
    where su.company_id = new.company_id
      and su.is_active is true
      and lower(trim(su.name)) = lower(trim(final_name))
  ) loop
    final_name := coalesce(user_name, 'Owner') || ' ' || suffix::text;
    suffix := suffix + 1;
  end loop;

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
  values (
    new.company_id,
    new.user_id,
    final_name,
    '0000',
    true,
    true,
    now(),
    case when new.role = 'owner' then 'admin' else new.role end,
    jsonb_build_object(
      'settings', true,
      'checkout', true,
      'inventory', true,
      'processing', true,
      'reports', true,
      'rota', true,
      'transfers', true
    ),
    jsonb_build_object(
      'include_in_payroll', true
    )
  );

  return new;
end;
$$;

drop trigger if exists ensure_membership_staff_profile_trigger
on public.company_memberships;

create trigger ensure_membership_staff_profile_trigger
after insert on public.company_memberships
for each row
execute function public.ensure_membership_staff_profile();

-- Preview rows by company after the repair.
select
  c.slug as company_slug,
  su.name,
  su.role,
  su.is_active,
  su.auth_user_id is not null as linked_to_login
from public.staff_users su
join public.companies c on c.id = su.company_id
where c.slug in ('dohpe', 'dl-retail')
order by c.slug, su.name;

commit;
