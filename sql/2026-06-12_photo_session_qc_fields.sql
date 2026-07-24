-- Photo session QC/completion fields.
-- Safe additive migration: no existing rows are deleted or rewritten.

alter table public.photo_sessions
  add column if not exists qc_status text not null default 'pending',
  add column if not exists qc_notes text null,
  add column if not exists completed_at timestamp with time zone null,
  add column if not exists completed_by_staff_id uuid null references public.staff_users(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'photo_sessions_qc_status_check'
  ) then
    alter table public.photo_sessions
      add constraint photo_sessions_qc_status_check
      check (qc_status in ('pending', 'complete', 'needs_reshoot', 'skipped'));
  end if;
end $$;

create index if not exists photo_sessions_company_qc_idx
on public.photo_sessions (company_id, qc_status, started_at desc);
