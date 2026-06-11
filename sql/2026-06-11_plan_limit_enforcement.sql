-- Database-level plan limit enforcement.
--
-- Blocks new usage above limits for non-internal/non-billing-exempt companies:
-- - active staff users
-- - active devices
-- - active locations
-- - enabled integrations/channels
-- - active departments
-- - new SKU/item rows
--
-- Existing rows can still be edited. The item/SKU trigger only enforces on
-- insert or company reassignment, so normal item edits are not blocked if a
-- company is already over-limit during migration.

begin;

create or replace function public.loopbase_company_limit_value(
  target_company_id uuid,
  target_limit_key text
)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  company_record record;
  limits_json jsonb;
  raw_value text;
begin
  if target_company_id is null or target_limit_key is null or target_limit_key = '' then
    return 0;
  end if;

  select
    c.billing_exempt,
    c.internal_account,
    coalesce(cs.limits, '{}'::jsonb) as limits
  into company_record
  from public.companies c
  left join lateral (
    select cs_inner.limits
    from public.company_subscriptions cs_inner
    where cs_inner.company_id = c.id
    order by
      case cs_inner.status
        when 'manual_active' then 1
        when 'active' then 2
        when 'trialing' then 3
        when 'past_due' then 4
        else 9
      end,
      cs_inner.updated_at desc nulls last,
      cs_inner.created_at desc nulls last
    limit 1
  ) cs on true
  where c.id = target_company_id;

  if not found then
    return 0;
  end if;

  if coalesce(company_record.billing_exempt, false)
     or coalesce(company_record.internal_account, false) then
    return null;
  end if;

  limits_json := coalesce(company_record.limits, '{}'::jsonb);

  if not (limits_json ? target_limit_key) then
    return 0;
  end if;

  if limits_json->target_limit_key = 'null'::jsonb then
    return null;
  end if;

  raw_value := limits_json->>target_limit_key;

  if raw_value is null or raw_value = '' then
    return 0;
  end if;

  return greatest(0, raw_value::integer);
end;
$$;

create or replace function public.loopbase_raise_if_limit_reached(
  target_company_id uuid,
  target_limit_key text,
  target_usage integer
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  limit_value integer;
begin
  limit_value := public.loopbase_company_limit_value(target_company_id, target_limit_key);

  if limit_value is null then
    return;
  end if;

  if target_usage >= limit_value then
    raise exception 'Plan limit reached: % is limited to %, current usage is %',
      target_limit_key,
      limit_value,
      target_usage
      using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.loopbase_enforce_staff_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_usage integer;
begin
  if coalesce(new.is_active, true) is not true then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.company_id is not distinct from new.company_id
     and coalesce(old.is_active, true) is true then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    select count(*)::integer
    into current_usage
    from public.staff_users su
    where su.company_id = new.company_id
      and coalesce(su.is_active, true) = true
      and su.id <> old.id;
  else
    select count(*)::integer
    into current_usage
    from public.staff_users su
    where su.company_id = new.company_id
      and coalesce(su.is_active, true) = true;
  end if;

  perform public.loopbase_raise_if_limit_reached(new.company_id, 'staff_limit', current_usage);
  return new;
end;
$$;

create or replace function public.loopbase_enforce_device_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_usage integer;
begin
  if coalesce(new.is_active, true) is not true then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.company_id is not distinct from new.company_id
     and coalesce(old.is_active, true) is true then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    select count(*)::integer
    into current_usage
    from public.company_devices cd
    where cd.company_id = new.company_id
      and coalesce(cd.is_active, true) = true
      and cd.id <> old.id;
  else
    select count(*)::integer
    into current_usage
    from public.company_devices cd
    where cd.company_id = new.company_id
      and coalesce(cd.is_active, true) = true;
  end if;

  perform public.loopbase_raise_if_limit_reached(new.company_id, 'device_limit', current_usage);
  return new;
end;
$$;

create or replace function public.loopbase_enforce_location_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_usage integer;
begin
  if coalesce(new.is_active, true) is not true then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.company_id is not distinct from new.company_id
     and coalesce(old.is_active, true) is true then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    select count(*)::integer
    into current_usage
    from public.locations l
    where l.company_id = new.company_id
      and coalesce(l.is_active, true) = true
      and l.id <> old.id;
  else
    select count(*)::integer
    into current_usage
    from public.locations l
    where l.company_id = new.company_id
      and coalesce(l.is_active, true) = true;
  end if;

  perform public.loopbase_raise_if_limit_reached(new.company_id, 'location_limit', current_usage);
  return new;
end;
$$;

create or replace function public.loopbase_enforce_channel_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_usage integer;
begin
  if coalesce(new.enabled, false) is not true then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.company_id is not distinct from new.company_id
     and coalesce(old.enabled, false) is true then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    select count(*)::integer
    into current_usage
    from public.integration_settings ins
    where ins.company_id = new.company_id
      and coalesce(ins.enabled, false) = true
      and ins.id <> old.id;
  else
    select count(*)::integer
    into current_usage
    from public.integration_settings ins
    where ins.company_id = new.company_id
      and coalesce(ins.enabled, false) = true;
  end if;

  perform public.loopbase_raise_if_limit_reached(new.company_id, 'channel_limit', current_usage);
  return new;
end;
$$;

create or replace function public.loopbase_enforce_department_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_usage integer;
begin
  if coalesce(new.is_active, true) is not true then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.company_id is not distinct from new.company_id
     and coalesce(old.is_active, true) is true then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    select count(*)::integer
    into current_usage
    from public.company_departments cd
    where cd.company_id = new.company_id
      and coalesce(cd.is_active, true) = true
      and cd.id <> old.id;
  else
    select count(*)::integer
    into current_usage
    from public.company_departments cd
    where cd.company_id = new.company_id
      and coalesce(cd.is_active, true) = true;
  end if;

  perform public.loopbase_raise_if_limit_reached(new.company_id, 'department_limit', current_usage);
  return new;
end;
$$;

create or replace function public.loopbase_enforce_sku_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_usage integer;
begin
  if tg_op = 'UPDATE' and old.company_id is not distinct from new.company_id then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    select count(*)::integer
    into current_usage
    from public.items i
    where i.company_id = new.company_id
      and i.id <> old.id;
  else
    select count(*)::integer
    into current_usage
    from public.items i
    where i.company_id = new.company_id;
  end if;

  perform public.loopbase_raise_if_limit_reached(new.company_id, 'sku_limit', current_usage);
  return new;
end;
$$;

drop trigger if exists loopbase_staff_limit_trigger on public.staff_users;
create trigger loopbase_staff_limit_trigger
before insert or update of company_id, is_active
on public.staff_users
for each row
execute function public.loopbase_enforce_staff_limit();

drop trigger if exists loopbase_device_limit_trigger on public.company_devices;
create trigger loopbase_device_limit_trigger
before insert or update of company_id, is_active
on public.company_devices
for each row
execute function public.loopbase_enforce_device_limit();

drop trigger if exists loopbase_location_limit_trigger on public.locations;
create trigger loopbase_location_limit_trigger
before insert or update of company_id, is_active
on public.locations
for each row
execute function public.loopbase_enforce_location_limit();

drop trigger if exists loopbase_channel_limit_trigger on public.integration_settings;
create trigger loopbase_channel_limit_trigger
before insert or update of company_id, enabled
on public.integration_settings
for each row
execute function public.loopbase_enforce_channel_limit();

drop trigger if exists loopbase_department_limit_trigger on public.company_departments;
create trigger loopbase_department_limit_trigger
before insert or update of company_id, is_active
on public.company_departments
for each row
execute function public.loopbase_enforce_department_limit();

drop trigger if exists loopbase_sku_limit_trigger on public.items;
create trigger loopbase_sku_limit_trigger
before insert or update of company_id
on public.items
for each row
execute function public.loopbase_enforce_sku_limit();

commit;
