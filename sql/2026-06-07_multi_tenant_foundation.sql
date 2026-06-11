-- Multi-tenant SaaS foundation.
-- Safe intent:
-- - Adds company/membership/billing tables.
-- - Seeds DOHPE and DL Retail as separate internal companies under the same account.
-- - Backfills existing business-owned rows to that default company.
-- - Adds indexes needed before app queries are moved to company filters.
--
-- This migration does not enable restrictive RLS policies and does not delete data.

begin;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  legal_name text null,
  trading_name text null,
  legacy_company_key text null,
  access_state text not null default 'trial',
  billing_exempt boolean not null default false,
  billing_exempt_reason text null,
  internal_account boolean not null default false,
  plan_key text null,
  billing_provider text null,
  billing_customer_id text null,
  subscription_status text null,
  trial_started_at timestamp with time zone null,
  trial_ends_at timestamp with time zone null,
  service_restricted_at timestamp with time zone null,
  created_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  archived_at timestamp with time zone null,
  constraint companies_slug_unique unique (slug),
  constraint companies_access_state_check check (
    access_state in (
      'active',
      'trial',
      'payment_required',
      'past_due',
      'cancelled',
      'suspended',
      'archived'
    )
  )
);

create table if not exists public.company_memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  status text not null default 'active',
  permissions jsonb not null default '{}'::jsonb,
  invited_by_user_id uuid null references auth.users(id) on delete set null,
  joined_at timestamp with time zone null default now(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint company_memberships_company_user_unique unique (company_id, user_id),
  constraint company_memberships_role_check check (
    role in ('owner', 'admin', 'manager', 'member', 'billing', 'viewer')
  ),
  constraint company_memberships_status_check check (
    status in ('active', 'invited', 'suspended', 'removed')
  )
);

create table if not exists public.company_departments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  department_type text not null default 'internal',
  description text null,
  royal_mail_department_id text null,
  postage_billing_settings jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint company_departments_company_code_unique unique (company_id, code),
  constraint company_departments_department_type_check check (
    department_type in ('internal', '3pl_client')
  )
);

create table if not exists public.company_devices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  device_key text not null,
  name text not null,
  device_type text not null default 'station',
  allowed_areas text[] not null default '{}'::text[],
  is_active boolean not null default true,
  last_seen_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint company_devices_company_device_key_unique unique (company_id, device_key),
  constraint company_devices_device_type_check check (
    device_type in ('checkout', 'scanner', 'receiving', 'admin_station', 'station')
  )
);

create table if not exists public.user_app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid null references public.companies(id) on delete set null,
  device_id uuid null references public.company_devices(id) on delete set null,
  session_key text not null,
  device_label text null,
  user_agent text null,
  ip_hint text null,
  status text not null default 'active',
  started_at timestamp with time zone not null default now(),
  last_seen_at timestamp with time zone not null default now(),
  ended_at timestamp with time zone null,
  ended_reason text null,
  metadata jsonb not null default '{}'::jsonb,
  constraint user_app_sessions_session_key_unique unique (session_key),
  constraint user_app_sessions_status_check check (
    status in ('active', 'revoked', 'expired', 'signed_out')
  )
);

create table if not exists public.staff_pin_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  staff_id uuid not null references public.staff_users(id) on delete cascade,
  user_app_session_id uuid null references public.user_app_sessions(id) on delete cascade,
  device_id uuid null references public.company_devices(id) on delete set null,
  allowed_area text null,
  status text not null default 'active',
  started_at timestamp with time zone not null default now(),
  last_activity_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone not null default (now() + interval '30 minutes'),
  ended_at timestamp with time zone null,
  ended_reason text null,
  metadata jsonb not null default '{}'::jsonb,
  constraint staff_pin_sessions_status_check check (
    status in ('active', 'expired', 'cleared', 'revoked')
  )
);

create table if not exists public.user_company_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_company_id uuid null references public.companies(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.company_subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null default 'manual',
  provider_customer_id text null,
  provider_subscription_id text null,
  provider_price_id text null,
  plan_key text not null default 'trial',
  status text not null default 'trialing',
  payment_status text null,
  current_period_start timestamp with time zone null,
  current_period_end timestamp with time zone null,
  trial_started_at timestamp with time zone null,
  trial_ends_at timestamp with time zone null,
  cancel_at timestamp with time zone null,
  cancelled_at timestamp with time zone null,
  limits jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint company_subscriptions_company_provider_unique unique (company_id, provider),
  constraint company_subscriptions_status_check check (
    status in ('trialing', 'active', 'past_due', 'unpaid', 'cancelled', 'incomplete', 'paused', 'manual_active')
  )
);

create table if not exists public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null unique,
  name text not null,
  description text null,
  is_public boolean not null default true,
  is_custom boolean not null default false,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.billing_plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.billing_plans(id) on delete cascade,
  version integer not null default 1,
  currency text not null default 'GBP',
  monthly_price numeric not null default 0,
  yearly_price numeric null,
  limits jsonb not null default '{}'::jsonb,
  features jsonb not null default '{}'::jsonb,
  provider text null,
  provider_price_id_monthly text null,
  provider_price_id_yearly text null,
  starts_at timestamp with time zone not null default now(),
  ends_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  constraint billing_plan_versions_plan_version_unique unique (plan_id, version)
);

create table if not exists public.company_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  role text not null default 'member',
  status text not null default 'pending',
  token_hash text null,
  invited_by_user_id uuid null references auth.users(id) on delete set null,
  accepted_by_user_id uuid null references auth.users(id) on delete set null,
  expires_at timestamp with time zone null,
  accepted_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint company_invites_status_check check (
    status in ('pending', 'accepted', 'revoked', 'expired')
  )
);

create table if not exists public.platform_admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text null,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.company_audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete set null,
  actor_user_id uuid null references auth.users(id) on delete set null,
  actor_staff_id uuid null references public.staff_users(id) on delete set null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now()
);

with seed_companies(name, slug, trading_name, legacy_company_key, access_state, billing_exempt, billing_exempt_reason, internal_account, plan_key, subscription_status) as (
  values
    (
      'DOHPE',
      'dohpe',
      'DOHPE',
      'dohpe',
      'active',
      true,
      'founder_lifetime',
      true,
      'internal_lifetime',
      'manual_active'
    ),
    (
      'DL Retail',
      'dl-retail',
      'DL Retail',
      'dlretail',
      'active',
      true,
      'founder_lifetime',
      true,
      'internal_lifetime',
      'manual_active'
    )
)
insert into public.companies (
  name,
  slug,
  trading_name,
  legacy_company_key,
  access_state,
  billing_exempt,
  billing_exempt_reason,
  internal_account,
  plan_key,
  subscription_status
)
select *
from seed_companies
on conflict (slug) do update
set
  access_state = 'active',
  billing_exempt = true,
  billing_exempt_reason = coalesce(public.companies.billing_exempt_reason, excluded.billing_exempt_reason),
  internal_account = true,
  plan_key = coalesce(public.companies.plan_key, excluded.plan_key),
  subscription_status = coalesce(public.companies.subscription_status, excluded.subscription_status),
  updated_at = now();

with plan_seed(plan_key, name, description, is_public, is_custom) as (
  values
    ('starter', 'Starter', 'Small team inventory and POS foundation.', true, false),
    ('growth', 'Growth', 'Growing resale teams with marketplace workflows.', true, false),
    ('pro', 'Pro', 'Higher-volume operations with advanced reporting.', true, false),
    ('enterprise', 'Enterprise', 'Custom limits and support.', false, true),
    ('internal_lifetime', 'Internal Lifetime', 'Manual internal access.', false, true)
)
insert into public.billing_plans (plan_key, name, description, is_public, is_custom)
select plan_key, name, description, is_public, is_custom
from plan_seed
on conflict (plan_key) do update
set
  name = excluded.name,
  description = excluded.description,
  is_public = excluded.is_public,
  is_custom = excluded.is_custom,
  updated_at = now();

with plan_limits(plan_key, monthly_price, limits, features) as (
  values
    (
      'starter',
      59,
      jsonb_build_object(
        'sku_limit', 2500,
        'user_limit', 5,
        'staff_limit', 10,
        'device_limit', 2,
        'location_limit', 2,
        'channel_limit', 2,
        'monthly_pos_transactions', 1000,
        'monthly_ai_generations', 250,
        'storage_gb', 10,
        'rfid_workflows', false,
        'advanced_reports', false,
        'cron_interval_minutes', 15
      ),
      jsonb_build_object('priority_support', false)
    ),
    (
      'growth',
      149,
      jsonb_build_object(
        'sku_limit', 15000,
        'user_limit', 15,
        'staff_limit', 30,
        'device_limit', 8,
        'location_limit', 6,
        'channel_limit', 6,
        'monthly_pos_transactions', 5000,
        'monthly_ai_generations', 1000,
        'storage_gb', 50,
        'rfid_workflows', true,
        'advanced_reports', true,
        'cron_interval_minutes', 5
      ),
      jsonb_build_object('priority_support', false)
    ),
    (
      'pro',
      299,
      jsonb_build_object(
        'sku_limit', 50000,
        'user_limit', 40,
        'staff_limit', 80,
        'device_limit', 25,
        'location_limit', 15,
        'channel_limit', 10,
        'monthly_pos_transactions', 20000,
        'monthly_ai_generations', 5000,
        'storage_gb', 200,
        'rfid_workflows', true,
        'advanced_reports', true,
        'cron_interval_minutes', 5
      ),
      jsonb_build_object('priority_support', true)
    ),
    (
      'enterprise',
      0,
      jsonb_build_object(
        'sku_limit', null,
        'user_limit', null,
        'staff_limit', null,
        'device_limit', null,
        'location_limit', null,
        'channel_limit', null,
        'monthly_pos_transactions', null,
        'monthly_ai_generations', null,
        'storage_gb', null,
        'rfid_workflows', true,
        'advanced_reports', true,
        'cron_interval_minutes', 1
      ),
      jsonb_build_object('priority_support', true)
    ),
    (
      'internal_lifetime',
      0,
      jsonb_build_object(
        'sku_limit', null,
        'user_limit', null,
        'staff_limit', null,
        'device_limit', null,
        'location_limit', null,
        'channel_limit', null,
        'monthly_pos_transactions', null,
        'monthly_ai_generations', null,
        'storage_gb', null,
        'rfid_workflows', true,
        'advanced_reports', true,
        'cron_interval_minutes', 1
      ),
      jsonb_build_object('priority_support', true)
    )
),
current_versions as (
  select bp.id as plan_id, pl.plan_key, pl.monthly_price, pl.limits, pl.features
  from plan_limits pl
  join public.billing_plans bp on bp.plan_key = pl.plan_key
)
insert into public.billing_plan_versions (
  plan_id,
  version,
  currency,
  monthly_price,
  limits,
  features,
  provider
)
select
  plan_id,
  1,
  'GBP',
  monthly_price,
  limits,
  features,
  'stripe'
from current_versions
on conflict (plan_id, version) do nothing;

insert into public.company_subscriptions (
  company_id,
  provider,
  plan_key,
  status,
  payment_status,
  metadata
)
select
  c.id,
  'manual',
  'internal_lifetime',
  'manual_active',
  'paid',
  jsonb_build_object('reason', 'founder_lifetime')
from public.companies c
where c.slug in ('dohpe', 'dl-retail')
on conflict (company_id, provider) do update
set
  plan_key = excluded.plan_key,
  status = excluded.status,
  payment_status = excluded.payment_status,
  metadata = public.company_subscriptions.metadata || excluded.metadata,
  updated_at = now();

-- Keep existing app users working after the first migration. Review this before
-- wider SaaS launch if more auth users exist than intended.
insert into public.company_memberships (
  company_id,
  user_id,
  role,
  status,
  permissions,
  joined_at
)
select
  c.id,
  u.id,
  'owner',
  'active',
  '{}'::jsonb,
  now()
from public.companies c
cross join auth.users u
where c.slug in ('dohpe', 'dl-retail')
on conflict (company_id, user_id) do nothing;

insert into public.user_company_preferences (user_id, active_company_id)
select
  u.id,
  c.id
from auth.users u
cross join public.companies c
where c.slug = 'dohpe'
on conflict (user_id) do nothing;

do $$
declare
  default_company_id uuid;
  tenant_table text;
  tenant_tables text[] := array[
    'app_settings',
    'integration_settings',
    'staff_users',
    'company_devices',
    'user_app_sessions',
    'staff_pin_sessions',
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
  select id into default_company_id
  from public.companies
  where slug = 'dohpe';

  foreach tenant_table in array tenant_tables
  loop
    if exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = tenant_table
    ) then
      if not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = tenant_table
          and column_name = 'company_id'
      ) then
        execute format(
          'alter table public.%I add column company_id uuid references public.companies(id) on delete restrict',
          tenant_table
        );
      end if;

      execute format(
        'update public.%I set company_id = $1 where company_id is null',
        tenant_table
      ) using default_company_id;

      execute format(
        'create index if not exists %I on public.%I (company_id)',
        tenant_table || '_company_id_idx',
        tenant_table
      );
    end if;
  end loop;
end $$;

alter table public.staff_users
add column if not exists auth_user_id uuid null references auth.users(id) on delete set null;

alter table public.items
add column if not exists department_id uuid null references public.company_departments(id) on delete set null;

create index if not exists staff_users_company_active_idx
on public.staff_users (company_id, is_active, name);

create index if not exists staff_users_auth_user_idx
on public.staff_users (auth_user_id)
where auth_user_id is not null;

create index if not exists items_company_department_idx
on public.items (company_id, department_id)
where department_id is not null;

create unique index if not exists user_app_sessions_one_active_per_user_idx
on public.user_app_sessions (user_id)
where status = 'active';

create index if not exists user_app_sessions_user_last_seen_idx
on public.user_app_sessions (user_id, last_seen_at desc);

create index if not exists staff_pin_sessions_staff_active_idx
on public.staff_pin_sessions (company_id, staff_id, status, expires_at desc);

insert into public.company_departments (
  company_id,
  code,
  name,
  is_default,
  is_active
)
select
  c.id,
  'DEFAULT',
  c.name,
  true,
  true
from public.companies c
where c.slug in ('dohpe', 'dl-retail')
on conflict (company_id, code) do update
set
  name = excluded.name,
  is_default = true,
  is_active = true,
  updated_at = now();

do $$
declare
  dl_retail_company_id uuid;
begin
  select id into dl_retail_company_id
  from public.companies
  where slug = 'dl-retail';

  if dl_retail_company_id is not null then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'rota_week_finalisations'
        and column_name = 'company_id'
    ) then
      update public.rota_week_finalisations
      set company_id = dl_retail_company_id
      where lower(company_key) in ('dlretail', 'dl_retail', 'dl retail');
    end if;

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'staff_holiday_year_rollovers'
        and column_name = 'company_id'
    ) then
      update public.staff_holiday_year_rollovers
      set company_id = dl_retail_company_id
      where lower(company_key) in ('dlretail', 'dl_retail', 'dl retail');
    end if;
  end if;
end $$;

-- Future tenants need their own bins per company. Keep this compatible with
-- existing rows by adding company_id to uniqueness instead of changing data.
drop index if exists public.warehouse_bins_location_bin_unique;

create unique index if not exists warehouse_bins_company_location_bin_unique
on public.warehouse_bins (company_id, location_name, bin_code)
where company_id is not null;

create unique index if not exists company_memberships_user_company_active_idx
on public.company_memberships (user_id, company_id)
where status = 'active';

create index if not exists companies_access_state_idx
on public.companies (access_state);

create index if not exists company_subscriptions_company_status_idx
on public.company_subscriptions (company_id, status);

create index if not exists company_audit_events_company_created_idx
on public.company_audit_events (company_id, created_at desc);

alter table public.companies enable row level security;
alter table public.company_memberships enable row level security;
alter table public.company_departments enable row level security;
alter table public.company_devices enable row level security;
alter table public.user_app_sessions enable row level security;
alter table public.staff_pin_sessions enable row level security;
alter table public.user_company_preferences enable row level security;
alter table public.company_subscriptions enable row level security;
alter table public.billing_plans enable row level security;
alter table public.billing_plan_versions enable row level security;
alter table public.company_invites enable row level security;
alter table public.platform_admin_users enable row level security;
alter table public.company_audit_events enable row level security;

drop policy if exists "authenticated read own companies"
on public.companies;

create policy "authenticated read own companies"
on public.companies
for select
to authenticated
using (
  exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = companies.id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
  )
  or exists (
    select 1
    from public.platform_admin_users pau
    where pau.user_id = auth.uid()
  )
);

drop policy if exists "authenticated read own memberships"
on public.company_memberships;

create policy "authenticated read own memberships"
on public.company_memberships
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.platform_admin_users pau
    where pau.user_id = auth.uid()
  )
);

drop policy if exists "authenticated read own company departments"
on public.company_departments;

create policy "authenticated read own company departments"
on public.company_departments
for select
to authenticated
using (
  exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = company_departments.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
  )
  or exists (
    select 1
    from public.platform_admin_users pau
    where pau.user_id = auth.uid()
  )
);

drop policy if exists "owners manage own company departments"
on public.company_departments;

create policy "owners manage own company departments"
on public.company_departments
for all
to authenticated
using (
  exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = company_departments.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('owner', 'admin')
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
    where cm.company_id = company_departments.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('owner', 'admin')
  )
  or exists (
    select 1
    from public.platform_admin_users pau
    where pau.user_id = auth.uid()
  )
);

drop policy if exists "authenticated read own company devices"
on public.company_devices;

create policy "authenticated read own company devices"
on public.company_devices
for select
to authenticated
using (
  exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = company_devices.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('owner', 'admin')
  )
  or exists (
    select 1
    from public.platform_admin_users pau
    where pau.user_id = auth.uid()
  )
);

drop policy if exists "owners manage own company devices"
on public.company_devices;

create policy "owners manage own company devices"
on public.company_devices
for all
to authenticated
using (
  exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = company_devices.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('owner', 'admin')
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
    where cm.company_id = company_devices.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('owner', 'admin')
  )
  or exists (
    select 1
    from public.platform_admin_users pau
    where pau.user_id = auth.uid()
  )
);

drop policy if exists "authenticated manage own app sessions"
on public.user_app_sessions;

create policy "authenticated manage own app sessions"
on public.user_app_sessions
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "authenticated read own company staff pin sessions"
on public.staff_pin_sessions;

create policy "authenticated read own company staff pin sessions"
on public.staff_pin_sessions
for select
to authenticated
using (
  exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = staff_pin_sessions.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
  )
  or exists (
    select 1
    from public.platform_admin_users pau
    where pau.user_id = auth.uid()
  )
);

drop policy if exists "authenticated manage own company preference"
on public.user_company_preferences;

create policy "authenticated manage own company preference"
on public.user_company_preferences
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "authenticated read own company subscriptions"
on public.company_subscriptions;

create policy "authenticated read own company subscriptions"
on public.company_subscriptions
for select
to authenticated
using (
  exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = company_subscriptions.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('owner', 'admin', 'billing')
  )
  or exists (
    select 1
    from public.platform_admin_users pau
    where pau.user_id = auth.uid()
  )
);

drop policy if exists "authenticated read active billing plans"
on public.billing_plans;

create policy "authenticated read active billing plans"
on public.billing_plans
for select
to authenticated
using (is_active = true);

drop policy if exists "authenticated read active billing plan versions"
on public.billing_plan_versions;

create policy "authenticated read active billing plan versions"
on public.billing_plan_versions
for select
to authenticated
using (
  ends_at is null
  and exists (
    select 1
    from public.billing_plans bp
    where bp.id = billing_plan_versions.plan_id
      and bp.is_active = true
  )
);

drop policy if exists "authenticated read own company invites"
on public.company_invites;

create policy "authenticated read own company invites"
on public.company_invites
for select
to authenticated
using (
  lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  or exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = company_invites.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('owner', 'admin')
  )
);

drop policy if exists "platform admins read platform_admin_users"
on public.platform_admin_users;

create policy "platform admins read platform_admin_users"
on public.platform_admin_users
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "authenticated read own company audit events"
on public.company_audit_events;

create policy "authenticated read own company audit events"
on public.company_audit_events
for select
to authenticated
using (
  exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = company_audit_events.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('owner', 'admin')
  )
  or exists (
    select 1
    from public.platform_admin_users pau
    where pau.user_id = auth.uid()
  )
);

commit;
