-- Preflight checks before/after operational RLS hardening.
-- This does not change data. Rows with null company_id will be hidden by
-- tenant RLS and should be repaired before relying on them.

with tenant_tables(table_name) as (
  values
    ('app_settings'),
    ('integration_settings'),
    ('locations'),
    ('warehouse_bins'),
    ('printed_labels_log'),
    ('photo_import_batches'),
    ('photo_import_groups'),
    ('photo_import_images'),
    ('inbound_batches'),
    ('inbound_batch_rfids'),
    ('fixed_costs'),
    ('payroll_settings'),
    ('staff_working_sessions'),
    ('staff_holiday_year_rollovers'),
    ('rota_week_finalisations'),
    ('rota_settings'),
    ('rota_google_tokens'),
    ('ebay_listing_drafts'),
    ('ebay_account_deletion_events'),
    ('ebay_platform_notification_events'),
    ('system_integrity_logs'),
    ('staff_users'),
    ('items'),
    ('item_stock_locations'),
    ('item_identifiers'),
    ('generated_skus'),
    ('sku_sequences'),
    ('item_images'),
    ('item_loans'),
    ('item_location_movements'),
    ('stock_movements'),
    ('stock_location_events'),
    ('stock_transfers'),
    ('stock_transfer_items'),
    ('linnworks_sync_queue'),
    ('linnworks_checked_open_orders'),
    ('linnworks_processed_sales'),
    ('pos_sales'),
    ('pos_sale_lines')
),
existing_tenant_tables as (
  select tt.table_name
  from tenant_tables tt
  join information_schema.tables t
    on t.table_schema = 'public'
   and t.table_name = tt.table_name
  join information_schema.columns c
    on c.table_schema = 'public'
   and c.table_name = tt.table_name
   and c.column_name = 'company_id'
)
select
  table_name,
  (select relrowsecurity from pg_class where oid = format('public.%I', table_name)::regclass) as rls_enabled,
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = existing_tenant_tables.table_name
      and policyname like 'loopbase tenant %'
  ) as loopbase_policy_count,
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = existing_tenant_tables.table_name
      and column_name = 'company_id'
  ) as has_company_id
from existing_tenant_tables
order by table_name;
