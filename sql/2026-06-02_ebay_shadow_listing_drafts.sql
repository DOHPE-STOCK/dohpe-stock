-- Stores the app-generated eBay listing draft before any direct publish exists.
-- This is shadow-mode only: no eBay listing is created by this table.

create table if not exists public.ebay_listing_drafts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  sku text not null,
  marketplace_id text not null default 'EBAY_GB',
  listing_mode text not null default 'linnworks_live_shadow_direct',
  status text not null default 'shadow_blocked',
  ready boolean not null default false,
  category_id text null,
  category_name text null,
  title text null,
  description text null,
  price numeric null,
  quantity integer not null default 0,
  condition_id text null,
  aspects jsonb not null default '{}'::jsonb,
  image_urls jsonb not null default '[]'::jsonb,
  policies jsonb not null default '{}'::jsonb,
  readiness jsonb not null default '{}'::jsonb,
  ebay_offer_id text null,
  ebay_listing_id text null,
  last_error text null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint ebay_listing_drafts_item_marketplace_unique unique (item_id, marketplace_id)
);

alter table public.ebay_listing_drafts enable row level security;

drop policy if exists "authenticated full access ebay_listing_drafts"
on public.ebay_listing_drafts;

create policy "authenticated full access ebay_listing_drafts"
on public.ebay_listing_drafts
for all
to authenticated
using (true)
with check (true);

create index if not exists ebay_listing_drafts_sku_idx
on public.ebay_listing_drafts (sku);

create index if not exists ebay_listing_drafts_status_idx
on public.ebay_listing_drafts (status, ready);
