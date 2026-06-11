-- Add company-count and department/client limits to existing billing plan versions.
-- Starter/Growth/Pro are single-company.
-- Enterprise/internal lifetime are unlimited and can add multiple companies.

begin;

with plan_company_limits(plan_key, company_limit) as (
  values
    ('starter', '1'::jsonb),
    ('growth', '1'::jsonb),
    ('pro', '1'::jsonb),
    ('enterprise', 'null'::jsonb),
    ('internal_lifetime', 'null'::jsonb)
)
update public.billing_plan_versions bpv
set limits = coalesce(bpv.limits, '{}'::jsonb) || jsonb_build_object('company_limit', pcl.company_limit)
from public.billing_plans bp
join plan_company_limits pcl on pcl.plan_key = bp.plan_key
where bpv.plan_id = bp.id;

update public.company_subscriptions cs
set limits = coalesce(cs.limits, '{}'::jsonb) || jsonb_build_object(
  'company_limit',
  case
    when cs.plan_key = 'starter' then 1
    when cs.plan_key = 'growth' then 1
    when cs.plan_key = 'pro' then 1
    when cs.plan_key in ('enterprise', 'internal_lifetime') then null
    else 1
  end
);

with plan_department_limits(plan_key, department_limit) as (
  values
    ('starter', '1'::jsonb),
    ('growth', '3'::jsonb),
    ('pro', '10'::jsonb),
    ('enterprise', 'null'::jsonb),
    ('internal_lifetime', 'null'::jsonb)
)
update public.billing_plan_versions bpv
set limits = coalesce(bpv.limits, '{}'::jsonb) || jsonb_build_object('department_limit', pdl.department_limit)
from public.billing_plans bp
join plan_department_limits pdl on pdl.plan_key = bp.plan_key
where bpv.plan_id = bp.id;

update public.company_subscriptions cs
set limits = coalesce(cs.limits, '{}'::jsonb) || jsonb_build_object(
  'department_limit',
  case
    when cs.plan_key = 'starter' then 1
    when cs.plan_key = 'growth' then 3
    when cs.plan_key = 'pro' then 10
    when cs.plan_key in ('enterprise', 'internal_lifetime') then null
    else 1
  end
);

commit;
