-- Location fulfilment capability flags.
--
-- Use capabilities instead of a hard "fulfilment location" type:
-- a warehouse, shop, 3PL, dropshipper or pop-up can store, receive, fulfil,
-- sell through POS, or any combination of those.

begin;

alter table public.locations
  add column if not exists can_store_stock boolean not null default true,
  add column if not exists can_receive_stock boolean not null default true,
  add column if not exists can_fulfil_orders boolean not null default true,
  add column if not exists can_sell_pos boolean not null default false,
  add column if not exists fulfilment_priority integer not null default 100,
  add column if not exists dispatch_country text null,
  add column if not exists dispatch_postcode text null,
  add column if not exists dispatch_address jsonb not null default '{}'::jsonb;

update public.locations
set
  can_store_stock = case when location_type = 'virtual' then false else can_store_stock end,
  can_receive_stock = case when location_type = 'virtual' then false else can_receive_stock end,
  can_fulfil_orders = case when location_type = 'virtual' then false else can_fulfil_orders end,
  can_sell_pos = case when is_retail is true then true else can_sell_pos end,
  fulfilment_priority = coalesce(fulfilment_priority, 100);

create index if not exists locations_company_fulfilment_idx
on public.locations (company_id, can_fulfil_orders, fulfilment_priority, is_active);

select
  c.slug,
  l.name,
  l.label,
  l.is_retail,
  l.can_store_stock,
  l.can_receive_stock,
  l.can_fulfil_orders,
  l.can_sell_pos,
  l.fulfilment_priority
from public.locations l
join public.companies c on c.id = l.company_id
where c.slug in ('dohpe', 'dl-retail', 'parapeak')
order by c.slug, l.sort_order nulls last, l.name;

commit;
