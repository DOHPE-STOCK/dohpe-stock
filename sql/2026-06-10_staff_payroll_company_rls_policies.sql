-- Tenant-aware RLS for staff users and payroll settings.
--
-- Fixes company-scoped Settings -> Users & Permissions and
-- Payroll & Holidays showing empty after staff rows were copied into
-- the selected company.
--
-- Rule:
-- - Any authenticated user with an active company membership can read
--   staff/payroll rows for that company.
-- - Owners/admins can create/update/delete those company rows.
-- - Platform admins can access all rows.

begin;

alter table public.staff_users enable row level security;
alter table public.payroll_settings enable row level security;

drop policy if exists "authenticated full access staff_users"
on public.staff_users;

drop policy if exists "authenticated read own company staff users"
on public.staff_users;

create policy "authenticated read own company staff users"
on public.staff_users
for select
to authenticated
using (
  exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = staff_users.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
  )
  or exists (
    select 1
    from public.platform_admin_users pau
    where pau.user_id = auth.uid()
  )
);

drop policy if exists "owners manage own company staff users"
on public.staff_users;

create policy "owners manage own company staff users"
on public.staff_users
for all
to authenticated
using (
  exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = staff_users.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('owner', 'admin')
  )
  or exists (
    select 1
    from public.platform_admin_users pau
    where pau.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = staff_users.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('owner', 'admin')
  )
  or exists (
    select 1
    from public.platform_admin_users pau
    where pau.user_id = auth.uid()
  )
);

drop policy if exists "authenticated full access payroll_settings"
on public.payroll_settings;

drop policy if exists "authenticated read own company payroll settings"
on public.payroll_settings;

create policy "authenticated read own company payroll settings"
on public.payroll_settings
for select
to authenticated
using (
  exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = payroll_settings.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
  )
  or exists (
    select 1
    from public.platform_admin_users pau
    where pau.user_id = auth.uid()
  )
);

drop policy if exists "owners manage own company payroll settings"
on public.payroll_settings;

create policy "owners manage own company payroll settings"
on public.payroll_settings
for all
to authenticated
using (
  exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = payroll_settings.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('owner', 'admin')
  )
  or exists (
    select 1
    from public.platform_admin_users pau
    where pau.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = payroll_settings.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('owner', 'admin')
  )
  or exists (
    select 1
    from public.platform_admin_users pau
    where pau.user_id = auth.uid()
  )
);

commit;
