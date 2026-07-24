-- Review return fields for sending items back to Working.
-- Safe additive migration: no existing item rows are rewritten.

alter table public.items
  add column if not exists review_return_reason text null,
  add column if not exists review_return_type text null,
  add column if not exists review_returned_at timestamp with time zone null,
  add column if not exists review_returned_by uuid null references public.staff_users(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'items_review_return_type_check'
  ) then
    alter table public.items
      add constraint items_review_return_type_check
      check (
        review_return_type is null
        or review_return_type in ('needs_reshoot', 'needs_edit', 'other')
      );
  end if;
end $$;

create index if not exists items_company_review_return_idx
on public.items (company_id, review_return_type, review_returned_at desc)
where review_returned_at is not null;
