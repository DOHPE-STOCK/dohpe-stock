-- Repair/bootstrap Loopbase platform admin access.
-- Use this after 2026-06-11_platform_admin_feature_flags.sql if /admin says
-- "Your login is not marked as an active platform admin."
--
-- It only promotes active owner/admin memberships on internal or billing-exempt
-- companies, and writes both legacy user_id and new auth_user_id columns.

begin;

alter table public.platform_admin_users
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists auth_user_id uuid references auth.users(id) on delete cascade,
  add column if not exists role text default 'owner',
  add column if not exists is_active boolean default true,
  add column if not exists notes text,
  add column if not exists created_at timestamp with time zone default now(),
  add column if not exists updated_at timestamp with time zone default now();

update public.platform_admin_users
set
  user_id = coalesce(user_id, auth_user_id),
  auth_user_id = coalesce(auth_user_id, user_id),
  role = coalesce(role, 'owner'),
  is_active = coalesce(is_active, true),
  updated_at = now();

insert into public.platform_admin_users (user_id, auth_user_id, role, is_active, notes)
select distinct
  cm.user_id,
  cm.user_id,
  'owner',
  true,
  'Bootstrapped from internal/billing-exempt company owner/admin membership'
from public.company_memberships cm
join public.companies c on c.id = cm.company_id
where cm.status = 'active'
  and cm.role in ('owner', 'admin')
  and (coalesce(c.internal_account, false) or coalesce(c.billing_exempt, false))
  and not exists (
    select 1
    from public.platform_admin_users pau
    where pau.user_id = cm.user_id
       or pau.auth_user_id = cm.user_id
  );

update public.platform_admin_users pau
set
  is_active = true,
  role = coalesce(pau.role, 'owner'),
  updated_at = now()
from public.company_memberships cm
join public.companies c on c.id = cm.company_id
where cm.status = 'active'
  and cm.role in ('owner', 'admin')
  and (coalesce(c.internal_account, false) or coalesce(c.billing_exempt, false))
  and (pau.user_id = cm.user_id or pau.auth_user_id = cm.user_id);

alter table public.platform_admin_users enable row level security;

drop policy if exists "platform admins read own admin row" on public.platform_admin_users;
create policy "platform admins read own admin row"
on public.platform_admin_users
for select
to authenticated
using (coalesce(auth_user_id, user_id) = auth.uid());

drop policy if exists "platform admins manage platform admins" on public.platform_admin_users;
create policy "platform admins manage platform admins"
on public.platform_admin_users
for all
to authenticated
using (
  exists (
    select 1
    from public.platform_admin_users pau
    where coalesce(pau.auth_user_id, pau.user_id) = auth.uid()
      and pau.is_active = true
      and pau.role in ('owner', 'admin')
  )
)
with check (
  exists (
    select 1
    from public.platform_admin_users pau
    where coalesce(pau.auth_user_id, pau.user_id) = auth.uid()
      and pau.is_active = true
      and pau.role in ('owner', 'admin')
  )
);

select
  pau.user_id,
  pau.auth_user_id,
  pau.role,
  pau.is_active,
  au.email
from public.platform_admin_users pau
left join auth.users au on au.id = coalesce(pau.auth_user_id, pau.user_id)
where pau.is_active = true
order by au.email nulls last;

commit;
