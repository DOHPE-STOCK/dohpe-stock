begin;

-- Retire the original seeded "Default Photo Station" so the app only works
-- with real Station Agent-created stations such as "Main Office PC".
--
-- If a company only has the legacy default station, rename that station to
-- Main Office PC so existing sessions/sources/captures remain attached.
-- If a company already has a real station, move legacy station-owned rows to
-- the real station, preferring a station named Main Office PC.

with legacy_only as (
  select legacy.id, legacy.company_id
  from public.photography_stations legacy
  where legacy.status <> 'archived'
    and (
      lower(legacy.name) = 'default photo station'
      or lower(legacy.code) in ('default-photo-station', 'default', 'photo-station', 'photo-1')
    )
    and not exists (
      select 1
      from public.photography_stations real_station
      where real_station.company_id = legacy.company_id
        and real_station.status <> 'archived'
        and real_station.id <> legacy.id
        and not (
          lower(real_station.name) = 'default photo station'
          or lower(real_station.code) in ('default-photo-station', 'default', 'photo-station', 'photo-1')
        )
    )
)
update public.photography_stations station
set
  name = 'Main Office PC',
  code = case
    when not exists (
      select 1
      from public.photography_stations existing
      where existing.company_id = station.company_id
        and existing.id <> station.id
        and lower(existing.code) = 'main-office-pc'
    )
      then 'MAIN-OFFICE-PC'
    else station.code
  end,
  description = coalesce(nullif(station.description, ''), 'Migrated from legacy default photo station.'),
  status = 'active',
  updated_at = now()
from legacy_only
where station.id = legacy_only.id
  and station.company_id = legacy_only.company_id;

create temporary table tmp_default_photo_station_mapping (
  company_id uuid not null,
  legacy_station_id uuid not null,
  target_station_id uuid not null
) on commit drop;

insert into tmp_default_photo_station_mapping (company_id, legacy_station_id, target_station_id)
select distinct on (legacy.company_id, legacy.id)
  legacy.company_id,
  legacy.id as legacy_station_id,
  target.id as target_station_id
from public.photography_stations legacy
join lateral (
  select real_station.id
  from public.photography_stations real_station
  where real_station.company_id = legacy.company_id
    and real_station.status <> 'archived'
    and real_station.id <> legacy.id
    and not (
      lower(real_station.name) = 'default photo station'
      or lower(real_station.code) in ('default-photo-station', 'default', 'photo-station', 'photo-1')
    )
  order by
    case when lower(real_station.name) = 'main office pc' then 0 else 1 end,
    case when real_station.description = 'Created automatically from Loopbase Station Agent.' then 0 else 1 end,
    real_station.created_at asc
  limit 1
) target on true
where legacy.status <> 'archived'
  and (
    lower(legacy.name) = 'default photo station'
    or lower(legacy.code) in ('default-photo-station', 'default', 'photo-station', 'photo-1')
  );

-- Avoid the one-active-session-per-station constraint when both stations
-- somehow have an active session. The real Station Agent station wins.
update public.photo_sessions legacy_session
set
  status = 'ended',
  ended_at = coalesce(legacy_session.ended_at, now()),
  updated_at = now()
from tmp_default_photo_station_mapping mapping
where legacy_session.company_id = mapping.company_id
  and legacy_session.station_id = mapping.legacy_station_id
  and legacy_session.status = 'active'
  and exists (
    select 1
    from public.photo_sessions target_session
    where target_session.company_id = mapping.company_id
      and target_session.station_id = mapping.target_station_id
      and target_session.status = 'active'
  );

-- Avoid source-name collisions on (company, station, lower(name)).
update public.photo_sources source
set
  name = left(source.name || ' (migrated ' || right(source.id::text, 6) || ')', 120),
  enabled = false,
  updated_at = now()
from tmp_default_photo_station_mapping mapping
where source.company_id = mapping.company_id
  and source.station_id = mapping.legacy_station_id
  and exists (
    select 1
    from public.photo_sources target_source
    where target_source.company_id = mapping.company_id
      and target_source.station_id = mapping.target_station_id
      and lower(target_source.name) = lower(source.name)
  );

update public.photo_sources source
set station_id = mapping.target_station_id,
    updated_at = now()
from tmp_default_photo_station_mapping mapping
where source.company_id = mapping.company_id
  and source.station_id = mapping.legacy_station_id;

update public.photo_captures capture
set station_id = mapping.target_station_id,
    updated_at = now()
from tmp_default_photo_station_mapping mapping
where capture.company_id = mapping.company_id
  and capture.station_id = mapping.legacy_station_id;

update public.photo_sessions session
set station_id = mapping.target_station_id,
    updated_at = now()
from tmp_default_photo_station_mapping mapping
where session.company_id = mapping.company_id
  and session.station_id = mapping.legacy_station_id;

update public.photography_calibration_profiles profile
set station_id = mapping.target_station_id,
    updated_at = now()
from tmp_default_photo_station_mapping mapping
where profile.company_id = mapping.company_id
  and profile.station_id = mapping.legacy_station_id;

update public.photo_worker_commands command
set station_id = mapping.target_station_id,
    updated_at = now()
from tmp_default_photo_station_mapping mapping
where command.company_id = mapping.company_id
  and command.station_id = mapping.legacy_station_id;

update public.photo_processing_jobs job
set station_id = mapping.target_station_id,
    updated_at = now()
from tmp_default_photo_station_mapping mapping
where job.company_id = mapping.company_id
  and job.station_id = mapping.legacy_station_id;

update public.photo_station_capture_intents intent
set station_id = mapping.target_station_id,
    updated_at = now()
from tmp_default_photo_station_mapping mapping
where intent.company_id = mapping.company_id
  and intent.station_id = mapping.legacy_station_id;

with active_legacy_sessions as (
  select distinct on (mapping.target_station_id)
    mapping.target_station_id,
    legacy_station.active_photo_session_id
  from tmp_default_photo_station_mapping mapping
  join public.photography_stations legacy_station
    on legacy_station.id = mapping.legacy_station_id
   and legacy_station.company_id = mapping.company_id
  where legacy_station.active_photo_session_id is not null
  order by mapping.target_station_id, legacy_station.updated_at desc
)
update public.photography_stations target
set
  active_photo_session_id = coalesce(target.active_photo_session_id, active_legacy_sessions.active_photo_session_id),
  updated_at = now()
from active_legacy_sessions
where target.id = active_legacy_sessions.target_station_id;

update public.photography_stations legacy
set
  status = 'archived',
  active_photo_session_id = null,
  description = concat_ws(
    ' ',
    nullif(legacy.description, ''),
    'Archived after migration to Station Agent station.'
  ),
  updated_at = now()
from tmp_default_photo_station_mapping mapping
where legacy.company_id = mapping.company_id
  and legacy.id = mapping.legacy_station_id;

commit;
