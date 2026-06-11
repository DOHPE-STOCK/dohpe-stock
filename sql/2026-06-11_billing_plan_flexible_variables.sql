-- Add a broader set of configurable SaaS plan variables.
-- Existing custom values are preserved: defaults are only used for missing keys.

begin;

with plan_defaults(plan_key, limits, features) as (
  values
    (
      'starter',
      jsonb_build_object(
        'monthly_online_orders', 500,
        'api_calls_per_month', 5000,
        'photo_storage_gb', 10,
        'audit_log_retention_days', 30,
        'data_retention_days', 365,
        'support_sla_hours', 72,
        'department_limit', 1
      ),
      jsonb_build_object(
        'payroll_reports', true,
        'pos_offline_queue', true,
        'marketplace_listing', true,
        'linnworks_sync', true,
        'direct_ebay', true,
        'royal_mail_integration', false,
        'multi_warehouse', false,
        'custom_domain', false,
        'dedicated_support', false
      )
    ),
    (
      'growth',
      jsonb_build_object(
        'monthly_online_orders', 2500,
        'api_calls_per_month', 25000,
        'photo_storage_gb', 50,
        'audit_log_retention_days', 90,
        'data_retention_days', 730,
        'support_sla_hours', 48,
        'department_limit', 3
      ),
      jsonb_build_object(
        'payroll_reports', true,
        'pos_offline_queue', true,
        'marketplace_listing', true,
        'linnworks_sync', true,
        'direct_ebay', true,
        'royal_mail_integration', true,
        'multi_warehouse', true,
        'custom_domain', false,
        'dedicated_support', false
      )
    ),
    (
      'pro',
      jsonb_build_object(
        'monthly_online_orders', 10000,
        'api_calls_per_month', 100000,
        'photo_storage_gb', 200,
        'audit_log_retention_days', 180,
        'data_retention_days', 1095,
        'support_sla_hours', 24,
        'department_limit', 10
      ),
      jsonb_build_object(
        'payroll_reports', true,
        'pos_offline_queue', true,
        'marketplace_listing', true,
        'linnworks_sync', true,
        'direct_ebay', true,
        'royal_mail_integration', true,
        'multi_warehouse', true,
        'custom_domain', true,
        'dedicated_support', false
      )
    ),
    (
      'enterprise',
      jsonb_build_object(
        'monthly_online_orders', null,
        'api_calls_per_month', null,
        'photo_storage_gb', null,
        'audit_log_retention_days', null,
        'data_retention_days', null,
        'support_sla_hours', 8,
        'department_limit', null
      ),
      jsonb_build_object(
        'payroll_reports', true,
        'pos_offline_queue', true,
        'marketplace_listing', true,
        'linnworks_sync', true,
        'direct_ebay', true,
        'royal_mail_integration', true,
        'multi_warehouse', true,
        'custom_domain', true,
        'dedicated_support', true
      )
    ),
    (
      'internal_lifetime',
      jsonb_build_object(
        'monthly_online_orders', null,
        'api_calls_per_month', null,
        'photo_storage_gb', null,
        'audit_log_retention_days', null,
        'data_retention_days', null,
        'support_sla_hours', null,
        'department_limit', null
      ),
      jsonb_build_object(
        'payroll_reports', true,
        'pos_offline_queue', true,
        'marketplace_listing', true,
        'linnworks_sync', true,
        'direct_ebay', true,
        'royal_mail_integration', true,
        'multi_warehouse', true,
        'custom_domain', true,
        'dedicated_support', true
      )
    )
)
update public.billing_plan_versions bpv
set
  limits = pd.limits || coalesce(bpv.limits, '{}'::jsonb),
  features = pd.features || coalesce(bpv.features, '{}'::jsonb)
from public.billing_plans bp
join plan_defaults pd on pd.plan_key = bp.plan_key
where bpv.plan_id = bp.id;

with plan_defaults(plan_key, limits) as (
  values
    ('starter', jsonb_build_object('monthly_online_orders', 500, 'api_calls_per_month', 5000, 'photo_storage_gb', 10, 'audit_log_retention_days', 30, 'data_retention_days', 365, 'support_sla_hours', 72, 'department_limit', 1)),
    ('growth', jsonb_build_object('monthly_online_orders', 2500, 'api_calls_per_month', 25000, 'photo_storage_gb', 50, 'audit_log_retention_days', 90, 'data_retention_days', 730, 'support_sla_hours', 48, 'department_limit', 3)),
    ('pro', jsonb_build_object('monthly_online_orders', 10000, 'api_calls_per_month', 100000, 'photo_storage_gb', 200, 'audit_log_retention_days', 180, 'data_retention_days', 1095, 'support_sla_hours', 24, 'department_limit', 10)),
    ('enterprise', jsonb_build_object('monthly_online_orders', null, 'api_calls_per_month', null, 'photo_storage_gb', null, 'audit_log_retention_days', null, 'data_retention_days', null, 'support_sla_hours', 8, 'department_limit', null)),
    ('internal_lifetime', jsonb_build_object('monthly_online_orders', null, 'api_calls_per_month', null, 'photo_storage_gb', null, 'audit_log_retention_days', null, 'data_retention_days', null, 'support_sla_hours', null, 'department_limit', null))
)
update public.company_subscriptions cs
set
  limits = pd.limits || coalesce(cs.limits, '{}'::jsonb),
  updated_at = now()
from plan_defaults pd
where cs.plan_key = pd.plan_key;

commit;
