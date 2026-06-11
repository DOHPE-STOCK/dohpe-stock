-- Operational RLS hardening for SaaS tenant isolation.
--
-- Safe intent:
-- - Replaces helper functions with platform-admin checks that support both
--   legacy user_id and auth_user_id.
-- - Allows active company members to read their own company rows.
-- - Allows owner/admin/manager/member writes only while the company has
--   operational access: active/trial/internal/billing-exempt.
-- - Keeps billing/viewer roles read-only.
-- - Applies only to tables that exist and already have company_id.
-- - Does not force RLS, so service-role cron/API routes still work.

begin;

create or replace function public.loopbase_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_admin_users pau
    where coalesce(pau.auth_user_id, pau.user_id) = auth.uid()
      and coalesce(pau.is_active, true) = true
      and coalesce(pau.role, 'owner') in ('owner', 'admin')
  );
$$;

create or replace function public.loopbase_company_has_operational_access(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.companies c
    where c.id = target_company_id
      and c.archived_at is null
      and (
        coalesce(c.billing_exempt, false) = true
        or coalesce(c.internal_account, false) = true
        or c.access_state in ('active', 'trial')
      )
  );
$$;

create or replace function public.loopbase_user_can_read_company(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    target_company_id is not null
    and (
      exists (
        select 1
        from public.company_memberships cm
        where cm.company_id = target_company_id
          and cm.user_id = auth.uid()
          and cm.status = 'active'
      )
      or public.loopbase_is_platform_admin()
    );
$$;

create or replace function public.loopbase_user_can_write_company(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    target_company_id is not null
    and public.loopbase_company_has_operational_access(target_company_id)
    and (
      exists (
        select 1
        from public.company_memberships cm
        where cm.company_id = target_company_id
          and cm.user_id = auth.uid()
          and cm.status = 'active'
          and cm.role in ('owner', 'admin', 'manager', 'member')
      )
      or public.loopbase_is_platform_admin()
    );
$$;

do $$
declare
  tenant_table text;
  tenant_tables text[] := array[
    -- lower-risk settings/supporting tables
    'app_settings',
    'integration_settings',
    'locations',
    'warehouse_bins',
    'printed_labels_log',
    'photo_import_batches',
    'photo_import_groups',
    'photo_import_images',
    'inbound_batches',
    'inbound_batch_rfids',
    'fixed_costs',
    'payroll_settings',
    'staff_working_sessions',
    'staff_holiday_year_rollovers',
    'rota_week_finalisations',
    'rota_settings',
    'rota_google_tokens',
    'ebay_listing_drafts',
    'ebay_account_deletion_events',
    'ebay_platform_notification_events',
    'system_integrity_logs',

    -- operational stock/POS/queue tables
    'staff_users',
    'items',
    'item_stock_locations',
    'item_identifiers',
    'generated_skus',
    'sku_sequences',
    'item_images',
    'item_loans',
    'item_location_movements',
    'stock_movements',
    'stock_location_events',
    'stock_transfers',
    'stock_transfer_items',
    'linnworks_sync_queue',
    'linnworks_checked_open_orders',
    'linnworks_processed_sales',
    'pos_sales',
    'pos_sale_lines'
  ];
begin
  foreach tenant_table in array tenant_tables
  loop
    if exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = tenant_table
    )
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = tenant_table
        and column_name = 'company_id'
    ) then
      execute format('alter table public.%I enable row level security', tenant_table);

      -- Remove old permissive or broad policies we have used during migration.
      execute format('drop policy if exists %I on public.%I', 'authenticated full access ' || tenant_table, tenant_table);
      execute format('drop policy if exists %I on public.%I', 'loopbase tenant read ' || tenant_table, tenant_table);
      execute format('drop policy if exists %I on public.%I', 'loopbase tenant write ' || tenant_table, tenant_table);
      execute format('drop policy if exists %I on public.%I', 'loopbase tenant select ' || tenant_table, tenant_table);
      execute format('drop policy if exists %I on public.%I', 'loopbase tenant insert ' || tenant_table, tenant_table);
      execute format('drop policy if exists %I on public.%I', 'loopbase tenant update ' || tenant_table, tenant_table);
      execute format('drop policy if exists %I on public.%I', 'loopbase tenant delete ' || tenant_table, tenant_table);

      execute format(
        'create policy %I on public.%I for select to authenticated using (public.loopbase_user_can_read_company(company_id))',
        'loopbase tenant select ' || tenant_table,
        tenant_table
      );

      execute format(
        'create policy %I on public.%I for insert to authenticated with check (public.loopbase_user_can_write_company(company_id))',
        'loopbase tenant insert ' || tenant_table,
        tenant_table
      );

      execute format(
        'create policy %I on public.%I for update to authenticated using (public.loopbase_user_can_write_company(company_id)) with check (public.loopbase_user_can_write_company(company_id))',
        'loopbase tenant update ' || tenant_table,
        tenant_table
      );

      execute format(
        'create policy %I on public.%I for delete to authenticated using (public.loopbase_user_can_write_company(company_id))',
        'loopbase tenant delete ' || tenant_table,
        tenant_table
      );
    end if;
  end loop;
end $$;

-- Keep platform_admin_users non-recursive. Admin writes go through service-role
-- API routes; authenticated users only need to read their own admin row.
alter table public.platform_admin_users enable row level security;

drop policy if exists "platform admins manage platform admins"
on public.platform_admin_users;

drop policy if exists "platform admins read platform_admin_users"
on public.platform_admin_users;

drop policy if exists "platform admins read own admin row"
on public.platform_admin_users;

create policy "platform admins read own admin row"
on public.platform_admin_users
for select
to authenticated
using (coalesce(auth_user_id, user_id) = auth.uid());

commit;
