-- Tenant-scoped support tickets and replies.

begin;

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  assigned_admin_user_id uuid null references auth.users(id) on delete set null,
  subject text not null,
  status text not null default 'open',
  priority text not null default 'normal',
  category text not null default 'general',
  last_reply_at timestamp with time zone null,
  last_customer_reply_at timestamp with time zone null,
  last_admin_reply_at timestamp with time zone null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint support_tickets_status_check check (status in ('open', 'waiting_on_support', 'waiting_on_customer', 'resolved', 'closed')),
  constraint support_tickets_priority_check check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint support_tickets_category_check check (category in ('general', 'billing', 'integration', 'stock', 'bug', 'feature'))
);

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  sender_type text not null default 'customer',
  body text not null,
  is_internal_note boolean not null default false,
  created_at timestamp with time zone not null default now(),
  constraint support_ticket_messages_sender_check check (sender_type in ('customer', 'admin'))
);

create index if not exists support_tickets_company_status_idx
on public.support_tickets (company_id, status, updated_at desc);

create index if not exists support_ticket_messages_ticket_idx
on public.support_ticket_messages (ticket_id, created_at);

alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;

drop policy if exists "loopbase support_tickets select own company"
on public.support_tickets;
create policy "loopbase support_tickets select own company"
on public.support_tickets
for select
to authenticated
using (
  public.loopbase_user_can_read_company(company_id)
  or public.loopbase_is_platform_admin()
);

drop policy if exists "loopbase support_tickets insert own company"
on public.support_tickets;
create policy "loopbase support_tickets insert own company"
on public.support_tickets
for insert
to authenticated
with check (
  public.loopbase_user_can_read_company(company_id)
  and created_by = auth.uid()
);

drop policy if exists "loopbase support_tickets update own company"
on public.support_tickets;
create policy "loopbase support_tickets update own company"
on public.support_tickets
for update
to authenticated
using (
  public.loopbase_user_can_read_company(company_id)
  or public.loopbase_is_platform_admin()
)
with check (
  public.loopbase_user_can_read_company(company_id)
  or public.loopbase_is_platform_admin()
);

drop policy if exists "loopbase support_ticket_messages select own company"
on public.support_ticket_messages;
create policy "loopbase support_ticket_messages select own company"
on public.support_ticket_messages
for select
to authenticated
using (
  (public.loopbase_user_can_read_company(company_id) and is_internal_note = false)
  or public.loopbase_is_platform_admin()
);

drop policy if exists "loopbase support_ticket_messages insert own company"
on public.support_ticket_messages;
create policy "loopbase support_ticket_messages insert own company"
on public.support_ticket_messages
for insert
to authenticated
with check (
  (
    public.loopbase_user_can_read_company(company_id)
    and sender_user_id = auth.uid()
    and sender_type = 'customer'
    and is_internal_note = false
  )
  or public.loopbase_is_platform_admin()
);

commit;
