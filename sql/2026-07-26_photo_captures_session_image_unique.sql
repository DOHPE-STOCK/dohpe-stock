-- Allow the same item image to be reopened in later photo sessions without
-- rewriting the older capture row/session history.
--
-- Previously this index allowed only one capture per item image globally:
--   (company_id, item_image_id) where item_image_id is not null
--
-- The photo monitor now needs one capture per session + item image instead.

begin;

drop index if exists public.photo_captures_company_item_image_unique_idx;

create unique index if not exists photo_captures_company_session_item_image_unique_idx
on public.photo_captures (company_id, session_id, item_image_id)
where session_id is not null
  and item_image_id is not null;

commit;
