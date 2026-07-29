-- Move item SKU type names away from the old single_use/reusable wording.
-- Safe intent:
-- - Existing single_use and reusable rows become standard.
-- - New supported SKU types are standard, parent_child, composite, digital.
-- - No stock movement, queue, POS, Linnworks, or transfer rows are changed.

begin;

update public.items
set sku_type = 'standard'
where lower(coalesce(sku_type, '')) in ('single_use', 'reusable', '');

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'items_sku_type_check'
      and conrelid = 'public.items'::regclass
  ) then
    alter table public.items drop constraint items_sku_type_check;
  end if;

  alter table public.items
    add constraint items_sku_type_check
    check (
      sku_type is null
      or sku_type in ('standard', 'parent_child', 'composite', 'digital')
    );
end $$;

select sku_type, count(*) as item_count
from public.items
group by sku_type
order by sku_type;

commit;
