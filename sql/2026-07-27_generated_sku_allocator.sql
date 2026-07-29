-- Database-backed generated SKU/barcode allocator.
--
-- Rules:
-- - Generated SKU labels are reserved per company.
-- - Manual SKUs remain company-scoped, so different tenants can use the same SKU.
-- - The allocator uses a locked company/year sequence row to avoid race conditions
--   when two users/devices print labels at the same time.
-- - Existing generated labels and current item barcodes/SKUs are preserved.

create table if not exists public.sku_sequences (
  company_id uuid not null references public.companies(id) on delete cascade,
  year_prefix text not null,
  next_sequence_number integer not null default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint sku_sequences_pkey primary key (company_id, year_prefix),
  constraint sku_sequences_year_prefix_check check (year_prefix ~ '^[0-9]{2}$'),
  constraint sku_sequences_next_sequence_number_check check (next_sequence_number >= 0)
);

alter table public.sku_sequences
add column if not exists year_prefix text;

alter table public.sku_sequences
add column if not exists next_sequence_number integer not null default 0;

alter table public.sku_sequences
add column if not exists created_at timestamp with time zone default now();

alter table public.sku_sequences
add column if not exists updated_at timestamp with time zone default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sku_sequences'
      and column_name = 'id'
  ) then
    alter table public.sku_sequences
    alter column id set default gen_random_uuid();
  end if;
end $$;

update public.sku_sequences
set year_prefix = to_char(now(), 'YY')
where year_prefix is null or trim(year_prefix) = '';

alter table public.sku_sequences
alter column year_prefix set not null;

alter table public.sku_sequences
alter column next_sequence_number set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sku_sequences_year_prefix_check'
      and conrelid = 'public.sku_sequences'::regclass
  ) then
    alter table public.sku_sequences
    add constraint sku_sequences_year_prefix_check check (year_prefix ~ '^[0-9]{2}$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'sku_sequences_next_sequence_number_check'
      and conrelid = 'public.sku_sequences'::regclass
  ) then
    alter table public.sku_sequences
    add constraint sku_sequences_next_sequence_number_check check (next_sequence_number >= 0);
  end if;
end $$;

create unique index if not exists sku_sequences_company_year_unique_idx
on public.sku_sequences (company_id, year_prefix);

alter table public.sku_sequences enable row level security;

drop policy if exists "loopbase read own company sku_sequences"
on public.sku_sequences;

create policy "loopbase read own company sku_sequences"
on public.sku_sequences
for select
to authenticated
using (public.loopbase_user_can_read_company(company_id));

drop policy if exists "loopbase write own company sku_sequences"
on public.sku_sequences;

create policy "loopbase write own company sku_sequences"
on public.sku_sequences
for all
to authenticated
using (public.loopbase_user_can_write_company(company_id))
with check (public.loopbase_user_can_write_company(company_id));

create unique index if not exists generated_skus_company_sku_unique_idx
on public.generated_skus (company_id, sku);

alter table public.generated_skus
add column if not exists year_prefix text;

alter table public.generated_skus
add column if not exists sequence_number integer;

alter table public.generated_skus
add column if not exists check_digit text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'generated_skus'
      and column_name = 'id'
  ) then
    alter table public.generated_skus
    alter column id set default gen_random_uuid();
  end if;
end $$;

create or replace function public.loopbase_luhn_check_digit(input_text text)
returns text
language plpgsql
immutable
as $$
declare
  total integer := 0;
  should_double boolean := true;
  idx integer;
  digit integer;
begin
  for idx in reverse length(input_text)..1 loop
    digit := substring(input_text from idx for 1)::integer;

    if should_double then
      digit := digit * 2;
      if digit > 9 then
        digit := digit - 9;
      end if;
    end if;

    total := total + digit;
    should_double := not should_double;
  end loop;

  return ((10 - (total % 10)) % 10)::text;
end;
$$;

create or replace function public.loopbase_reserve_generated_skus(
  target_company_id uuid,
  requested_quantity integer default 1
)
returns table (sku text)
language plpgsql
security definer
set search_path = public
as $$
declare
  active_year_prefix text := to_char(now(), 'YY');
  quantity integer := greatest(1, least(100, coalesce(requested_quantity, 1)));
  next_number integer;
  sequence_number integer;
  body_number text;
  candidate_sku text;
  inserted_sku text;
  reserved_count integer := 0;
  attempts integer := 0;
begin
  if target_company_id is null then
    raise exception 'Company ID is required.';
  end if;

  insert into public.sku_sequences (
    company_id,
    year_prefix,
    next_sequence_number
  )
  values (
    target_company_id,
    active_year_prefix,
    0
  )
  on conflict (company_id, year_prefix) do nothing;

  select ss.next_sequence_number
  into next_number
  from public.sku_sequences ss
  where ss.company_id = target_company_id
    and ss.year_prefix = active_year_prefix
  for update;

  while reserved_count < quantity loop
    if attempts >= 10000000 then
      raise exception 'Could not generate enough unique SKU numbers for this company/year.';
    end if;

    sequence_number := mod(next_number, 10000000);
    next_number := next_number + 1;
    attempts := attempts + 1;

    body_number := active_year_prefix || lpad(sequence_number::text, 7, '0');
    candidate_sku := body_number || public.loopbase_luhn_check_digit(body_number);

    if exists (
      select 1
      from public.items i
      where i.company_id = target_company_id
        and (
          upper(trim(i.sku)) = candidate_sku
          or upper(trim(coalesce(i.barcode_number, ''))) = candidate_sku
        )
    ) then
      continue;
    end if;

    if exists (
      select 1
      from public.item_identifiers ii
      where ii.company_id = target_company_id
        and ii.is_active is true
        and ii.identifier_value_normalized = candidate_sku
    ) then
      continue;
    end if;

    inserted_sku := null;

    insert into public.generated_skus (
      company_id,
      sku,
      year_prefix,
      sequence_number,
      check_digit
    )
    values (
      target_company_id,
      candidate_sku,
      active_year_prefix,
      sequence_number,
      right(candidate_sku, 1)
    )
    on conflict (company_id, sku) do nothing
    returning public.generated_skus.sku into inserted_sku;

    if inserted_sku is not null then
      sku := inserted_sku;
      reserved_count := reserved_count + 1;
      return next;
    end if;
  end loop;

  update public.sku_sequences
  set
    next_sequence_number = next_number,
    updated_at = now()
  where company_id = target_company_id
    and year_prefix = active_year_prefix;

  return;
end;
$$;

grant execute on function public.loopbase_reserve_generated_skus(uuid, integer)
to authenticated;
