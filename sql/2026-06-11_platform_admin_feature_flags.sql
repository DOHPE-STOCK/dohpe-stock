-- Platform admin area and customer feature flags.
-- Feature flags let one shared build expose custom pages/modules only to
-- selected companies, with optional per-user overrides for future use.

begin;

create table if not exists public.platform_admin_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  role text not null default 'owner',
  is_active boolean not null default true,
  notes text null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- If this table already existed from an earlier local/SQL experiment,
-- create table if not exists will not add the columns above. Upgrade it in place.
alter table public.platform_admin_users
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists auth_user_id uuid references auth.users(id) on delete cascade,
  add column if not exists role text default 'owner',
  add column if not exists is_active boolean default true,
  add column if not exists notes text,
  add column if not exists created_at timestamp with time zone default now(),
  add column if not exists updated_at timestamp with time zone default now();

update public.platform_admin_users
set
  user_id = coalesce(user_id, auth_user_id),
  auth_user_id = coalesce(auth_user_id, user_id),
  role = coalesce(role, 'owner'),
  is_active = coalesce(is_active, true),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'platform_admin_users_auth_user_id_key'
      and conrelid = 'public.platform_admin_users'::regclass
  ) then
    alter table public.platform_admin_users
      add constraint platform_admin_users_auth_user_id_key unique (auth_user_id);
  end if;
end $$;

create table if not exists public.feature_modules (
  feature_key text primary key,
  name text not null,
  description text null,
  category text not null default 'custom',
  is_active boolean not null default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.company_features (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  feature_key text not null references public.feature_modules(feature_key) on delete cascade,
  enabled boolean not null default false,
  notes text null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint company_features_company_feature_unique unique (company_id, feature_key)
);

create table if not exists public.user_feature_overrides (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_key text not null references public.feature_modules(feature_key) on delete cascade,
  enabled boolean not null default true,
  notes text null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint user_feature_overrides_user_company_feature_unique unique (user_id, company_id, feature_key)
);

insert into public.feature_modules (feature_key, name, description, category)
values
  (
    'loan_page',
    'Loan workflow',
    'Custom scanner page for lending items out and returning them to stock.',
    'custom'
  )
on conflict (feature_key) do update
set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  is_active = true,
  updated_at = now();

-- Bootstrap platform admins from existing internal/manual companies so the
-- current owner is not locked out of /admin after the migration.
insert into public.platform_admin_users (user_id, auth_user_id, role, notes)
select distinct
  cm.user_id,
  cm.user_id,
  'owner',
  'Bootstrapped from internal/billing-exempt company owner/admin membership'
from public.company_memberships cm
join public.companies c on c.id = cm.company_id
where cm.status = 'active'
  and cm.role in ('owner', 'admin')
  and (coalesce(c.internal_account, false) or coalesce(c.billing_exempt, false))
on conflict (auth_user_id) do update
set
  user_id = coalesce(public.platform_admin_users.user_id, excluded.user_id),
  is_active = true,
  updated_at = now();

create index if not exists company_features_company_idx
on public.company_features (company_id);

create index if not exists user_feature_overrides_lookup_idx
on public.user_feature_overrides (user_id, company_id, feature_key);

alter table public.platform_admin_users enable row level security;
alter table public.feature_modules enable row level security;
alter table public.company_features enable row level security;
alter table public.user_feature_overrides enable row level security;

drop policy if exists "platform admins read all companies" on public.companies;
create policy "platform admins read all companies"
on public.companies
for select
to authenticated
using (
  exists (
    select 1
    from public.platform_admin_users pau
    where coalesce(pau.auth_user_id, pau.user_id) = auth.uid()
      and pau.is_active = true
      and pau.role in ('owner', 'admin')
  )
);

drop policy if exists "platform admins read own admin row" on public.platform_admin_users;
create policy "platform admins read own admin row"
on public.platform_admin_users
for select
to authenticated
using (coalesce(auth_user_id, user_id) = auth.uid());

drop policy if exists "platform admins manage platform admins" on public.platform_admin_users;
create policy "platform admins manage platform admins"
on public.platform_admin_users
for all
to authenticated
using (
  exists (
    select 1
    from public.platform_admin_users pau
    where coalesce(pau.auth_user_id, pau.user_id) = auth.uid()
      and pau.is_active = true
      and pau.role in ('owner', 'admin')
  )
)
with check (
  exists (
    select 1
    from public.platform_admin_users pau
    where coalesce(pau.auth_user_id, pau.user_id) = auth.uid()
      and pau.is_active = true
      and pau.role in ('owner', 'admin')
  )
);

drop policy if exists "authenticated read active feature modules" on public.feature_modules;
create policy "authenticated read active feature modules"
on public.feature_modules
for select
to authenticated
using (is_active = true);

drop policy if exists "platform admins manage feature modules" on public.feature_modules;
create policy "platform admins manage feature modules"
on public.feature_modules
for all
to authenticated
using (
  exists (
    select 1
    from public.platform_admin_users pau
    where coalesce(pau.auth_user_id, pau.user_id) = auth.uid()
      and pau.is_active = true
      and pau.role in ('owner', 'admin')
  )
)
with check (
  exists (
    select 1
    from public.platform_admin_users pau
    where coalesce(pau.auth_user_id, pau.user_id) = auth.uid()
      and pau.is_active = true
      and pau.role in ('owner', 'admin')
  )
);

drop policy if exists "members read own company features" on public.company_features;
create policy "members read own company features"
on public.company_features
for select
to authenticated
using (
  exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = company_features.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
  )
);

drop policy if exists "platform admins manage company features" on public.company_features;
create policy "platform admins manage company features"
on public.company_features
for all
to authenticated
using (
  exists (
    select 1
    from public.platform_admin_users pau
    where coalesce(pau.auth_user_id, pau.user_id) = auth.uid()
      and pau.is_active = true
      and pau.role in ('owner', 'admin')
  )
)
with check (
  exists (
    select 1
    from public.platform_admin_users pau
    where coalesce(pau.auth_user_id, pau.user_id) = auth.uid()
      and pau.is_active = true
      and pau.role in ('owner', 'admin')
  )
);

drop policy if exists "users read own feature overrides" on public.user_feature_overrides;
create policy "users read own feature overrides"
on public.user_feature_overrides
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "platform admins manage user feature overrides" on public.user_feature_overrides;
create policy "platform admins manage user feature overrides"
on public.user_feature_overrides
for all
to authenticated
using (
  exists (
    select 1
    from public.platform_admin_users pau
    where coalesce(pau.auth_user_id, pau.user_id) = auth.uid()
      and pau.is_active = true
      and pau.role in ('owner', 'admin')
  )
)
with check (
  exists (
    select 1
    from public.platform_admin_users pau
    where coalesce(pau.auth_user_id, pau.user_id) = auth.uid()
      and pau.is_active = true
      and pau.role in ('owner', 'admin')
  )
);

commit;
