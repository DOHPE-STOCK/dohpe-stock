-- Hard delete Dave from DL Retail staff only.
--
-- Intent:
-- - Delete only public.staff_users rows named Dave under the DL Retail company.
-- - Do not touch Dohpe staff.
-- - Do not delete auth users, memberships, rota history, sales, or other data.

begin;

delete from public.staff_users su
using public.companies c
where su.company_id = c.id
  and c.slug in ('dl-retail', 'dlretail', 'dl_retail')
  and lower(trim(su.name)) = 'dave'
returning
  c.slug as company_slug,
  su.id as deleted_staff_id,
  su.name as deleted_staff_name;

commit;
