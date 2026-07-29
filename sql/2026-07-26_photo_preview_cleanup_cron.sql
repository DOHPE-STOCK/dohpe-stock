-- Daily cleanup for stale temporary photo previews.
--
-- Preview representations are working files only. Accepted processed images
-- are protected by the API route and are not deleted by this job.
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
  if exists (select 1 from cron.job where jobname = 'loopbase-photo-preview-cleanup') then
    perform cron.unschedule('loopbase-photo-preview-cleanup');
  end if;
end $$;

-- 03:47 daily. Runs after the original cleanup job and only clears previews older than 24 hours.
select cron.schedule(
  'loopbase-photo-preview-cleanup',
  '47 3 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'loopbase_app_url') || '/api/photography/preview-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'loopbase_cron_secret')
    ),
    body := jsonb_build_object(
      'source', 'supabase-cron',
      'job', 'loopbase-photo-preview-cleanup',
      'older_than_hours', 24,
      'triggered_at', now()
    )
  );
  $$
);
