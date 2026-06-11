-- Mark Parapeak as an internal/founder company.
-- Safe intent:
-- - Only affects an existing company whose name/slug/trading name is Parapeak.
-- - Makes it billing-exempt/manual-active like DOHPE and DL Retail.
-- - Upserts the matching manual internal_lifetime subscription row.

begin;

with target_company as (
  select id
  from public.companies
  where lower(coalesce(slug, '')) in ('parapeak', 'para-peak')
     or lower(coalesce(name, '')) = 'parapeak'
     or lower(coalesce(trading_name, '')) = 'parapeak'
     or lower(coalesce(slug, '')) like '%parapeak%'
     or lower(coalesce(name, '')) like '%parapeak%'
     or lower(coalesce(trading_name, '')) like '%parapeak%'
  order by created_at desc
  limit 1
),
updated_company as (
  update public.companies c
  set
    access_state = 'active',
    billing_exempt = true,
    billing_exempt_reason = coalesce(c.billing_exempt_reason, 'founder_lifetime'),
    internal_account = true,
    plan_key = 'internal_lifetime',
    billing_provider = coalesce(c.billing_provider, 'manual'),
    subscription_status = 'manual_active',
    trial_ends_at = null,
    service_restricted_at = null,
    updated_at = now()
  from target_company tc
  where c.id = tc.id
  returning c.id
)
insert into public.company_subscriptions (
  company_id,
  provider,
  plan_key,
  status,
  payment_status,
  limits,
  metadata,
  updated_at
)
select
  uc.id,
  'manual',
  'internal_lifetime',
  'manual_active',
  'paid',
  jsonb_build_object(
    'company_limit', null,
    'sku_limit', null,
    'user_limit', null,
    'staff_limit', null,
    'device_limit', null,
    'location_limit', null,
    'channel_limit', null,
    'department_limit', null,
    'monthly_pos_transactions', null,
    'monthly_ai_generations', null,
    'storage_gb', null,
    'rfid_workflows', true,
    'advanced_reports', true,
    'cron_interval_minutes', 1
  ),
  jsonb_build_object('reason', 'founder_lifetime', 'source', 'mark_parapeak_internal'),
  now()
from updated_company uc
on conflict (company_id, provider) do update
set
  plan_key = excluded.plan_key,
  status = excluded.status,
  payment_status = excluded.payment_status,
  limits = excluded.limits,
  metadata = public.company_subscriptions.metadata || excluded.metadata,
  updated_at = now();

-- If Parapeak already had a stripe/trial subscription row, update it too.
-- The settings page can otherwise read that row first and still display trial.
with target_company as (
  select id
  from public.companies
  where lower(coalesce(slug, '')) in ('parapeak', 'para-peak')
     or lower(coalesce(name, '')) = 'parapeak'
     or lower(coalesce(trading_name, '')) = 'parapeak'
     or lower(coalesce(slug, '')) like '%parapeak%'
     or lower(coalesce(name, '')) like '%parapeak%'
     or lower(coalesce(trading_name, '')) like '%parapeak%'
)
update public.company_subscriptions cs
set
  plan_key = 'internal_lifetime',
  status = 'manual_active',
  payment_status = 'paid',
  trial_started_at = null,
  trial_ends_at = null,
  cancel_at = null,
  cancelled_at = null,
  limits = jsonb_build_object(
    'company_limit', null,
    'sku_limit', null,
    'user_limit', null,
    'staff_limit', null,
    'device_limit', null,
    'location_limit', null,
    'channel_limit', null,
    'department_limit', null,
    'monthly_pos_transactions', null,
    'monthly_ai_generations', null,
    'storage_gb', null,
    'rfid_workflows', true,
    'advanced_reports', true,
    'cron_interval_minutes', 1
  ),
  metadata = coalesce(cs.metadata, '{}'::jsonb) || jsonb_build_object(
    'reason', 'founder_lifetime',
    'source', 'mark_parapeak_internal_all_subscriptions'
  ),
  updated_at = now()
from target_company tc
where cs.company_id = tc.id;

select
  c.id,
  c.name,
  c.slug,
  c.access_state,
  c.billing_exempt,
  c.internal_account,
  c.plan_key,
  c.subscription_status
from public.companies c
where lower(coalesce(c.slug, '')) in ('parapeak', 'para-peak')
   or lower(coalesce(c.name, '')) = 'parapeak'
   or lower(coalesce(c.trading_name, '')) = 'parapeak'
   or lower(coalesce(c.slug, '')) like '%parapeak%'
   or lower(coalesce(c.name, '')) like '%parapeak%'
   or lower(coalesce(c.trading_name, '')) like '%parapeak%';

select
  c.name,
  c.slug,
  cs.provider,
  cs.plan_key,
  cs.status,
  cs.payment_status,
  cs.trial_ends_at
from public.companies c
join public.company_subscriptions cs on cs.company_id = c.id
where lower(coalesce(c.slug, '')) in ('parapeak', 'para-peak')
   or lower(coalesce(c.name, '')) = 'parapeak'
   or lower(coalesce(c.trading_name, '')) = 'parapeak'
   or lower(coalesce(c.slug, '')) like '%parapeak%'
   or lower(coalesce(c.name, '')) like '%parapeak%'
   or lower(coalesce(c.trading_name, '')) like '%parapeak%'
order by cs.created_at desc;

commit;
