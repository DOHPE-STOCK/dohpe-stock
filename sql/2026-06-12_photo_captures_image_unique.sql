-- Make photo capture association idempotent per product image.
-- Safe: does not change existing image rows or item stock/order logic.

begin;

create unique index if not exists photo_captures_company_item_image_unique_idx
on public.photo_captures (company_id, item_image_id)
where item_image_id is not null;

commit;
