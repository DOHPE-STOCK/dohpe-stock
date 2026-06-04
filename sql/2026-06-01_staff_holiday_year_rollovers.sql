-- Holiday year rollover records.
-- Reports calculate carried-over holiday automatically from finalised rota
-- weeks as of the day before the holiday year starts. This table stores only
-- editable overrides/corrections for that calculated opening balance.

create table if not exists public.staff_holiday_year_rollovers (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_users(id) on delete cascade,
  company_key text not null,
  holiday_year_start date not null,
  holiday_year_end date not null,
  carried_over_hours numeric not null default 0,
  source_holiday_year_start date null,
  source_holiday_year_end date null,
  source_accrued_hours numeric not null default 0,
  source_taken_hours numeric not null default 0,
  source_closing_balance_hours numeric not null default 0,
  notes text null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint staff_holiday_year_rollovers_staff_company_year_unique
    unique (staff_id, company_key, holiday_year_start)
);

alter table public.staff_holiday_year_rollovers enable row level security;

drop policy if exists "authenticated full access staff_holiday_year_rollovers"
on public.staff_holiday_year_rollovers;

create policy "authenticated full access staff_holiday_year_rollovers"
on public.staff_holiday_year_rollovers
for all
to authenticated
using (true)
with check (true);

create index if not exists staff_holiday_year_rollovers_lookup_idx
on public.staff_holiday_year_rollovers (company_key, holiday_year_start, staff_id);
