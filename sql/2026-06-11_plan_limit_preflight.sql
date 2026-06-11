-- Plan limit preflight.
-- Shows current usage against company subscription limits before enabling
-- database-level limit enforcement.

with company_limit_source as (
  select distinct on (c.id)
    c.id as company_id,
    c.name,
    c.slug,
    c.access_state,
    c.billing_exempt,
    c.internal_account,
    cs.plan_key,
    cs.status as subscription_status,
    coalesce(cs.limits, '{}'::jsonb) as limits
  from public.companies c
  left join public.company_subscriptions cs on cs.company_id = c.id
  order by
    c.id,
    case cs.status
      when 'manual_active' then 1
      when 'active' then 2
      when 'trialing' then 3
      when 'past_due' then 4
      else 9
    end,
    cs.updated_at desc nulls last,
    cs.created_at desc nulls last
),
usage_rows as (
  select company_id, 'staff_limit' as limit_key, count(*)::integer as used
  from public.staff_users
  where coalesce(is_active, true) = true
  group by company_id

  union all

  select company_id, 'device_limit', count(*)::integer
  from public.company_devices
  where coalesce(is_active, true) = true
  group by company_id

  union all

  select company_id, 'location_limit', count(*)::integer
  from public.locations
  where coalesce(is_active, true) = true
  group by company_id

  union all

  select company_id, 'channel_limit', count(*)::integer
  from public.integration_settings
  where coalesce(enabled, false) = true
  group by company_id

  union all

  select company_id, 'department_limit', count(*)::integer
  from public.company_departments
  where coalesce(is_active, true) = true
  group by company_id

  union all

  select company_id, 'sku_limit', count(*)::integer
  from public.items
  group by company_id
)
select
  cls.name,
  cls.slug,
  cls.plan_key,
  cls.subscription_status,
  cls.billing_exempt,
  cls.internal_account,
  limits.limit_key,
  coalesce(ur.used, 0) as used,
  case
    when cls.billing_exempt or cls.internal_account then null
    when cls.limits ? limits.limit_key and cls.limits->limits.limit_key = 'null'::jsonb then null
    when cls.limits ? limits.limit_key then (cls.limits->>limits.limit_key)::integer
    else null
  end as limit_value,
  case
    when cls.billing_exempt or cls.internal_account then 'OK_INTERNAL'
    when cls.limits ? limits.limit_key and cls.limits->limits.limit_key = 'null'::jsonb then 'OK_UNLIMITED'
    when not (cls.limits ? limits.limit_key) then 'NO_LIMIT_SET'
    when coalesce(ur.used, 0) <= (cls.limits->>limits.limit_key)::integer then 'OK'
    else 'OVER_LIMIT'
  end as status
from company_limit_source cls
cross join (
  values
    ('staff_limit'),
    ('device_limit'),
    ('location_limit'),
    ('channel_limit'),
    ('department_limit'),
    ('sku_limit')
) as limits(limit_key)
left join usage_rows ur
  on ur.company_id = cls.company_id
 and ur.limit_key = limits.limit_key
order by cls.name, limits.limit_key;
