-- Move external cronjob.org schedules into Supabase Cron.
--
-- Before running:
-- 1. In Supabase SQL editor, replace YOUR_CRON_SECRET_HERE with the same CRON_SECRET
--    value configured in Vercel.
-- 2. Run this once.
-- 3. Disable the matching cronjob.org jobs after Supabase shows successful runs.
--
-- These jobs only call existing app API routes. They do not change POS, queue,
-- Linnworks, transfer, or stock logic.

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

-- Store endpoint and auth token outside cron.job SQL text.
select vault.create_secret('https://loopbase.io', 'loopbase_app_url')
where not exists (
  select 1 from vault.decrypted_secrets where name = 'loopbase_app_url'
);

select vault.create_secret('YOUR_CRON_SECRET_HERE', 'loopbase_cron_secret')
where not exists (
  select 1 from vault.decrypted_secrets where name = 'loopbase_cron_secret'
);

-- Recreate only our named jobs. This avoids duplicate schedules if the file is rerun.
do $$
declare
  job_name text;
begin
  foreach job_name in array array[
    'loopbase-linnworks-open-orders',
    'loopbase-linnworks-processed-orders',
    'loopbase-linnworks-stock-poll',
    'loopbase-linnworks-process-queue',
    'loopbase-system-integrity-check'
  ]
  loop
    if exists (select 1 from cron.job where jobname = job_name) then
      perform cron.unschedule(job_name);
    end if;
  end loop;
end $$;

-- 00,05,10... Pull open Linnworks orders.
select cron.schedule(
  'loopbase-linnworks-open-orders',
  '0-59/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'loopbase_app_url') || '/api/sync/linnworks-orders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'loopbase_cron_secret')
    ),
    body := jsonb_build_object('source', 'supabase-cron', 'job', 'loopbase-linnworks-open-orders', 'triggered_at', now())
  );
  $$
);

-- 01,06,11... Check processed/cancelled orders.
select cron.schedule(
  'loopbase-linnworks-processed-orders',
  '1-59/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'loopbase_app_url') || '/api/sync/linnworks-processed-orders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'loopbase_cron_secret')
    ),
    body := jsonb_build_object('source', 'supabase-cron', 'job', 'loopbase-linnworks-processed-orders', 'triggered_at', now())
  );
  $$
);

-- 02,07,12... Poll Linnworks stock.
select cron.schedule(
  'loopbase-linnworks-stock-poll',
  '2-59/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'loopbase_app_url') || '/api/sync/linnworks-stock-poll',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'loopbase_cron_secret')
    ),
    body := jsonb_build_object('source', 'supabase-cron', 'job', 'loopbase-linnworks-stock-poll', 'triggered_at', now())
  );
  $$
);

-- 03,08,13... Push pending queue rows.
select cron.schedule(
  'loopbase-linnworks-process-queue',
  '3-59/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'loopbase_app_url') || '/api/sync/process-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'loopbase_cron_secret')
    ),
    body := jsonb_build_object('source', 'supabase-cron', 'job', 'loopbase-linnworks-process-queue', 'triggered_at', now())
  );
  $$
);

-- Once an hour: check database/application integrity.
select cron.schedule(
  'loopbase-system-integrity-check',
  '17 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'loopbase_app_url') || '/api/system/integrity-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'loopbase_cron_secret')
    ),
    body := jsonb_build_object('source', 'supabase-cron', 'job', 'loopbase-system-integrity-check', 'triggered_at', now())
  );
  $$
);

-- Confirm installed jobs.
select jobid, jobname, schedule, active
from cron.job
where jobname like 'loopbase-%'
order by jobname;
