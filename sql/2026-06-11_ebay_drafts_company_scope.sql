-- Scope eBay listing drafts to companies.
-- Existing draft rows are backfilled from their item company_id.

begin;

alter table public.ebay_listing_drafts
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

update public.ebay_listing_drafts eld
set company_id = i.company_id
from public.items i
where eld.item_id = i.id
  and eld.company_id is null
  and i.company_id is not null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'ebay_listing_drafts_item_marketplace_unique'
      and conrelid = 'public.ebay_listing_drafts'::regclass
  ) then
    alter table public.ebay_listing_drafts
      drop constraint ebay_listing_drafts_item_marketplace_unique;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ebay_listing_drafts_company_item_marketplace_unique'
      and conrelid = 'public.ebay_listing_drafts'::regclass
  ) then
    alter table public.ebay_listing_drafts
      add constraint ebay_listing_drafts_company_item_marketplace_unique
      unique (company_id, item_id, marketplace_id);
  end if;
end $$;

create index if not exists ebay_listing_drafts_company_sku_idx
on public.ebay_listing_drafts (company_id, sku);

drop policy if exists "authenticated full access ebay_listing_drafts"
on public.ebay_listing_drafts;

drop policy if exists "authenticated read own company ebay listing drafts"
on public.ebay_listing_drafts;

create policy "authenticated read own company ebay listing drafts"
on public.ebay_listing_drafts
for select
to authenticated
using (
  exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = ebay_listing_drafts.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
  )
);

commit;
