-- Reporting, sub-category, stock movement, rota finalisation, and payroll foundations.
-- Safe to run more than once.

alter table public.items
add column if not exists sub_category text;

do $$
declare
  source_column text;
begin
  select column_name
  into source_column
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'items'
    and column_name in ('sub_type', 'subtype', 'item_sub_type')
  order by array_position(array['sub_type', 'subtype', 'item_sub_type'], column_name)
  limit 1;

  if source_column is not null then
    execute format(
      'update public.items
       set sub_category = coalesce(nullif(sub_category, ''''), nullif(%I, ''''))
       where sub_category is null or sub_category = ''''',
      source_column
    );
  end if;
end $$;

alter table public.pos_sale_lines
add column if not exists sub_category text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'pos_sale_lines'
      and column_name = 'sub_type'
  ) then
    update public.pos_sale_lines
    set sub_category = coalesce(nullif(sub_category, ''), nullif(sub_type, ''))
    where sub_category is null or sub_category = '';
  end if;
end $$;

create table if not exists public.stock_location_events (
  id uuid primary key default gen_random_uuid(),
  item_id uuid null references public.items(id) on delete set null,
  sku text not null,
  event_type text not null,
  quantity_delta integer not null,
  from_location text null,
  from_bin text null,
  to_location text null,
  to_bin text null,
  reference_type text null,
  reference_id text null,
  note text null,
  created_by uuid null references public.staff_users(id) on delete set null,
  created_at timestamp with time zone default now()
);

alter table public.stock_location_events enable row level security;

drop policy if exists "authenticated full access stock_location_events"
on public.stock_location_events;

create policy "authenticated full access stock_location_events"
on public.stock_location_events
for all
to authenticated
using (true)
with check (true);

create index if not exists stock_location_events_sku_created_idx
on public.stock_location_events (sku, created_at desc);

create index if not exists stock_location_events_location_created_idx
on public.stock_location_events (to_location, from_location, created_at desc);

create table if not exists public.fixed_costs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  amount numeric not null default 0,
  cadence text not null default 'monthly',
  category text null,
  location_name text null,
  starts_on date null,
  ends_on date null,
  is_active boolean not null default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table public.fixed_costs enable row level security;

drop policy if exists "authenticated full access fixed_costs"
on public.fixed_costs;

create policy "authenticated full access fixed_costs"
on public.fixed_costs
for all
to authenticated
using (true)
with check (true);

create table if not exists public.rota_week_finalisations (
  id uuid primary key default gen_random_uuid(),
  company_key text not null,
  week_id text not null,
  status text not null default 'pending',
  totals jsonb not null default '{}'::jsonb,
  notes text null,
  finalised_by uuid null references public.staff_users(id) on delete set null,
  finalised_at timestamp with time zone null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint rota_week_finalisations_company_week_unique unique (company_key, week_id)
);

alter table public.rota_week_finalisations enable row level security;

drop policy if exists "authenticated full access rota_week_finalisations"
on public.rota_week_finalisations;

create policy "authenticated full access rota_week_finalisations"
on public.rota_week_finalisations
for all
to authenticated
using (true)
with check (true);

create table if not exists public.payroll_settings (
  id text primary key default 'default',
  payroll_period text not null default 'weekly',
  payroll_start_day integer null,
  payroll_start_date date null,
  holiday_year_start_month integer not null default 4,
  holiday_year_start_day integer not null default 1,
  default_holiday_method text not null default 'fixed_weeks',
  default_holiday_weeks numeric not null default 5.6,
  default_accrual_percent numeric not null default 12.07,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

insert into public.payroll_settings (id)
values ('default')
on conflict (id) do nothing;

alter table public.payroll_settings enable row level security;

drop policy if exists "authenticated full access payroll_settings"
on public.payroll_settings;

create policy "authenticated full access payroll_settings"
on public.payroll_settings
for all
to authenticated
using (true)
with check (true);

alter table public.staff_users
add column if not exists payroll_settings jsonb not null default '{}'::jsonb;

create table if not exists public.staff_working_sessions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_users(id) on delete cascade,
  session_type text not null default 'working',
  started_at timestamp with time zone not null default now(),
  ended_at timestamp with time zone null,
  ended_reason text null,
  created_at timestamp with time zone default now()
);

alter table public.staff_working_sessions enable row level security;

drop policy if exists "authenticated full access staff_working_sessions"
on public.staff_working_sessions;

create policy "authenticated full access staff_working_sessions"
on public.staff_working_sessions
for all
to authenticated
using (true)
with check (true);

create index if not exists staff_working_sessions_staff_started_idx
on public.staff_working_sessions (staff_id, started_at desc);
