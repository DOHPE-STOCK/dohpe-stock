-- Per-staff PIN session timeout.
-- Safe: adds a defaulted column only. Existing staff keep the current 30 minute behaviour.

alter table public.staff_users
  add column if not exists pin_timeout_minutes integer not null default 30;

update public.staff_users
set pin_timeout_minutes = 30
where pin_timeout_minutes is null;

alter table public.staff_users
  drop constraint if exists staff_users_pin_timeout_minutes_check;

alter table public.staff_users
  add constraint staff_users_pin_timeout_minutes_check
  check (pin_timeout_minutes between 5 and 480);
