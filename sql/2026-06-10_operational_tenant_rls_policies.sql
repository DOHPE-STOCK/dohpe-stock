-- Operational tenant RLS policies.
--
-- Intent:
-- - Enforce company_id isolation for tenant-owned operational tables.
-- - Owners/admins/managers/members can use their own company data.
-- - Billing/viewer users can read but not mutate operational rows.
-- - Platform admins can access all rows.
--
-- Run after the app has been smoke-tested with active_company_id filtering.

begin;

alter table if exists public.system_integrity_logs
add column if not exists company_id uuid references public.companies(id) on delete set null;

create or replace function public.loopbase_user_can_read_company(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1
      from public.company_memberships cm
      where cm.company_id = target_company_id
        and cm.user_id = auth.uid()
        and cm.status = 'active'
    )
    or exists (
      select 1
      from public.platform_admin_users pau
      where pau.user_id = auth.uid()
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
    exists (
      select 1
      from public.company_memberships cm
      where cm.company_id = target_company_id
        and cm.user_id = auth.uid()
        and cm.status = 'active'
        and cm.role in ('owner', 'admin', 'manager', 'member')
    )
    or exists (
      select 1
      from public.platform_admin_users pau
      where pau.user_id = auth.uid()
    );
$$;

do $$
declare
  tenant_table text;
  tenant_tables text[] := array[
    'app_settings',
    'integration_settings',
    'staff_users',
    'locations',
    'warehouse_bins',
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
    'pos_sale_lines',
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
    'system_integrity_logs'
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

      execute format(
        'drop policy if exists %I on public.%I',
        'loopbase tenant read ' || tenant_table,
        tenant_table
      );

      execute format(
        'create policy %I on public.%I for select to authenticated using (public.loopbase_user_can_read_company(company_id))',
        'loopbase tenant read ' || tenant_table,
        tenant_table
      );

      execute format(
        'drop policy if exists %I on public.%I',
        'loopbase tenant write ' || tenant_table,
        tenant_table
      );

      execute format(
        'create policy %I on public.%I for all to authenticated using (public.loopbase_user_can_write_company(company_id)) with check (public.loopbase_user_can_write_company(company_id))',
        'loopbase tenant write ' || tenant_table,
        tenant_table
      );
    end if;
  end loop;
end $$;

commit;
