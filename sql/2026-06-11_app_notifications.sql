-- Tenant-scoped app notifications.
--
-- Stored notifications are used for durable events. Generated warnings such
-- as approaching plan limits can be dismissed per user through source keys.

begin;

create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid null references auth.users(id) on delete cascade,
  source_key text null,
  notification_type text not null default 'system',
  severity text not null default 'info',
  title text not null,
  body text null,
  href text null,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamp with time zone null,
  dismissed_at timestamp with time zone null,
  expires_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint app_notifications_severity_check check (severity in ('info', 'success', 'warning', 'critical')),
  constraint app_notifications_type_check check (notification_type in ('system', 'billing', 'limit', 'maintenance', 'integration', 'stock', 'workflow', 'support'))
);

create unique index if not exists app_notifications_company_source_user_idx
on public.app_notifications (
  company_id,
  coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
  source_key
)
where source_key is not null;

create index if not exists app_notifications_company_unread_idx
on public.app_notifications (company_id, dismissed_at, read_at, created_at desc);

create table if not exists public.app_notification_dismissals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_key text not null,
  dismissed_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  constraint app_notification_dismissals_unique unique (company_id, user_id, source_key)
);

create index if not exists app_notification_dismissals_lookup_idx
on public.app_notification_dismissals (company_id, user_id, source_key);

create or replace function public.loopbase_notify_support_reply(
  target_company_id uuid,
  target_user_id uuid,
  target_ticket_id text,
  target_subject text,
  target_href text default '/settings/company'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  notification_id uuid;
  clean_subject text;
  notification_source_key text;
begin
  clean_subject := nullif(trim(coalesce(target_subject, '')), '');
  notification_source_key := 'support:ticket:' || coalesce(nullif(target_ticket_id, ''), gen_random_uuid()::text);

  update public.app_notifications
  set
    title = 'Support replied',
    body = coalesce(clean_subject, 'A support ticket has a new reply.'),
    href = target_href,
    metadata = jsonb_build_object('ticket_id', target_ticket_id),
    read_at = null,
    dismissed_at = null,
    updated_at = now()
  where company_id = target_company_id
    and coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid) =
      coalesce(target_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and source_key = notification_source_key
  returning id into notification_id;

  if notification_id is null then
    insert into public.app_notifications (
      company_id,
      user_id,
      source_key,
      notification_type,
      severity,
      title,
      body,
      href,
      metadata,
      read_at,
      dismissed_at,
      updated_at
    )
    values (
      target_company_id,
      target_user_id,
      notification_source_key,
      'support',
      'info',
      'Support replied',
      coalesce(clean_subject, 'A support ticket has a new reply.'),
      target_href,
      jsonb_build_object('ticket_id', target_ticket_id),
      null,
      null,
      now()
    )
    returning id into notification_id;
  end if;

  delete from public.app_notification_dismissals
  where company_id = target_company_id
    and user_id = target_user_id
    and source_key = notification_source_key;

  return notification_id;
end;
$$;

alter table public.app_notifications enable row level security;
alter table public.app_notification_dismissals enable row level security;

drop policy if exists "loopbase app_notifications select own company"
on public.app_notifications;
create policy "loopbase app_notifications select own company"
on public.app_notifications
for select
to authenticated
using (
  public.loopbase_user_can_read_company(company_id)
  and (user_id is null or user_id = auth.uid())
);

drop policy if exists "loopbase app_notifications update own company"
on public.app_notifications;
create policy "loopbase app_notifications update own company"
on public.app_notifications
for update
to authenticated
using (
  public.loopbase_user_can_read_company(company_id)
  and (user_id is null or user_id = auth.uid())
)
with check (
  public.loopbase_user_can_read_company(company_id)
  and (user_id is null or user_id = auth.uid())
);

drop policy if exists "loopbase app_notification_dismissals select own company"
on public.app_notification_dismissals;
create policy "loopbase app_notification_dismissals select own company"
on public.app_notification_dismissals
for select
to authenticated
using (
  public.loopbase_user_can_read_company(company_id)
  and user_id = auth.uid()
);

drop policy if exists "loopbase app_notification_dismissals insert own company"
on public.app_notification_dismissals;
create policy "loopbase app_notification_dismissals insert own company"
on public.app_notification_dismissals
for insert
to authenticated
with check (
  public.loopbase_user_can_read_company(company_id)
  and user_id = auth.uid()
);

commit;
