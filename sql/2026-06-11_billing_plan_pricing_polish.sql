-- Align billing plan version prices with the current Loopbase pricing UI.
-- Starter: GBP 69/month, GBP 759/year
-- Growth: GBP 149/month, GBP 1639/year
-- Pro: GBP 299/month, GBP 3289/year
-- Enterprise/internal remain custom/manual.

begin;

with price_updates(plan_key, monthly_price, yearly_price) as (
  values
    ('starter', 69, 759),
    ('growth', 149, 1639),
    ('pro', 299, 3289),
    ('enterprise', 0, null),
    ('internal_lifetime', 0, null)
)
update public.billing_plan_versions bpv
set
  monthly_price = price_updates.monthly_price,
  yearly_price = price_updates.yearly_price
from public.billing_plans bp
join price_updates on price_updates.plan_key = bp.plan_key
where bpv.plan_id = bp.id;

-- Keep descriptions customer-facing for the billing screen.
update public.billing_plans
set
  description = case plan_key
    when 'starter' then 'Single-company inventory, POS and marketplace foundations.'
    when 'growth' then 'Growing warehouse teams with RFID workflows and more automation.'
    when 'pro' then 'Higher-volume operations with advanced reporting and larger limits.'
    when 'enterprise' then 'Multi-company, custom limits, onboarding and bespoke workflows.'
    when 'internal_lifetime' then 'Manual internal lifetime access.'
    else description
  end,
  updated_at = now()
where plan_key in ('starter', 'growth', 'pro', 'enterprise', 'internal_lifetime');

commit;
