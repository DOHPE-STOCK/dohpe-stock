-- Add marketplace channel placeholders and status columns.
-- Safe intent:
-- - Moves the old Loyverse integration row to Grailed.
-- - Adds Vestiaire Collective and Whatnot integration rows.
-- - Adds item status columns for new marketplace export indicators.
-- - Removes the legacy Loyverse integration row and status column after the app stops using them.
-- - Removes zero-value previous pay-rate baseline entries from staff payroll settings.

begin;

alter table public.items
  add column if not exists grailed_status text not null default 'not_listed',
  add column if not exists vestiaire_collective_status text not null default 'not_listed',
  add column if not exists whatnot_status text not null default 'not_listed';

update public.integration_settings
set
  channel = 'grailed',
  settings = coalesce(settings, '{}'::jsonb),
  updated_at = now()
where channel = 'loyverse'
  and not exists (
    select 1
    from public.integration_settings existing
    where existing.channel = 'grailed'
  );

delete from public.integration_settings
where channel = 'loyverse';

with channel_rows(channel, enabled, auto_sync, connection_status, settings, created_at, updated_at) as (
  values
    ('grailed', false, false, 'not_connected', '{}'::jsonb, now(), now()),
    ('vestiaire_collective', false, false, 'not_connected', '{}'::jsonb, now(), now()),
    ('whatnot', false, false, 'not_connected', '{}'::jsonb, now(), now())
)
insert into public.integration_settings (
  channel,
  enabled,
  auto_sync,
  connection_status,
  settings,
  created_at,
  updated_at
)
select
  channel_rows.channel,
  channel_rows.enabled,
  channel_rows.auto_sync,
  channel_rows.connection_status,
  channel_rows.settings,
  channel_rows.created_at,
  channel_rows.updated_at
from channel_rows
where not exists (
  select 1
  from public.integration_settings existing
  where existing.channel = channel_rows.channel
);

alter table public.items
  drop column if exists loyverse_status;

update public.staff_users
set
  payroll_settings = jsonb_set(
    coalesce(payroll_settings, '{}'::jsonb),
    '{pay_rate_history}',
    coalesce(
      (
        select jsonb_agg(entry order by entry->>'effective_date')
        from jsonb_array_elements(coalesce(payroll_settings->'pay_rate_history', '[]'::jsonb)) entry
        where not (
          entry->>'effective_date' = '1900-01-01'
          and coalesce(nullif(entry->>'hourly_rate', '')::numeric, 0) = 0
        )
      ),
      '[]'::jsonb
    ),
    true
  )
where payroll_settings ? 'pay_rate_history'
  and exists (
    select 1
    from jsonb_array_elements(coalesce(payroll_settings->'pay_rate_history', '[]'::jsonb)) entry
    where entry->>'effective_date' = '1900-01-01'
      and coalesce(nullif(entry->>'hourly_rate', '')::numeric, 0) = 0
  );

commit;
