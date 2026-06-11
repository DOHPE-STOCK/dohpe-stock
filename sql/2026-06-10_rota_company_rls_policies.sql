-- Tenant-aware RLS for rota settings and rota finalisations.
--
-- Fixes "Rota save failed. Check Supabase rota_settings permissions."
-- after moving rota to company-scoped keys.
--
-- Rule:
-- - Any authenticated user with an active membership of the selected company
--   can read/write rota settings and finalised rota records for that company.
-- - Platform admins can also access these rows.

begin;

alter table public.rota_settings enable row level security;
alter table public.rota_week_finalisations enable row level security;

drop policy if exists "authenticated full access rota_settings"
on public.rota_settings;

drop policy if exists "authenticated manage own company rota settings"
on public.rota_settings;

create policy "authenticated manage own company rota settings"
on public.rota_settings
for all
to authenticated
using (
  exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = rota_settings.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
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
    where cm.company_id = rota_settings.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
  )
  or exists (
    select 1
    from public.platform_admin_users pau
    where pau.user_id = auth.uid()
  )
);

drop policy if exists "authenticated full access rota_week_finalisations"
on public.rota_week_finalisations;

drop policy if exists "authenticated manage own company rota finalisations"
on public.rota_week_finalisations;

create policy "authenticated manage own company rota finalisations"
on public.rota_week_finalisations
for all
to authenticated
using (
  exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = rota_week_finalisations.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
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
    where cm.company_id = rota_week_finalisations.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
  )
  or exists (
    select 1
    from public.platform_admin_users pau
    where pau.user_id = auth.uid()
  )
);

commit;
