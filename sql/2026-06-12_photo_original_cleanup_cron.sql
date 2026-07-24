-- Daily cleanup for temporary cloud originals.
--
-- Safe rule is enforced by the API route:
-- it only deletes original files when item_images.processed_url is present.
--
-- Requires:
-- - pg_cron
-- - pg_net
-- - vault secret loopbase_app_url
-- - vault secret loopbase_cron_secret

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'loopbase-photo-original-cleanup') then
    perform cron.unschedule('loopbase-photo-original-cleanup');
  end if;
end $$;

-- 03:37 daily. Deliberately away from the frequent Linnworks cron cadence.
select cron.schedule(
  'loopbase-photo-original-cleanup',
  '37 3 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'loopbase_app_url') || '/api/photography/original-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'loopbase_cron_secret')
    ),
    body := jsonb_build_object('source', 'supabase-cron', 'job', 'loopbase-photo-original-cleanup', 'triggered_at', now())
  );
  $$
);
