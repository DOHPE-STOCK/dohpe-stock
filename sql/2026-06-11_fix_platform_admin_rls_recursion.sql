-- Fix platform admin RLS recursion.
-- The previous "platform admins manage platform admins" policy queried
-- platform_admin_users from inside a platform_admin_users policy, which can
-- trigger "infinite recursion detected in policy".
--
-- Platform admin writes are handled through service-role API routes, so normal
-- authenticated users only need to read their own admin row directly.

begin;

alter table public.platform_admin_users enable row level security;

drop policy if exists "platform admins manage platform admins"
on public.platform_admin_users;

drop policy if exists "platform admins read own admin row"
on public.platform_admin_users;

drop policy if exists "platform admins read platform_admin_users"
on public.platform_admin_users;

create policy "platform admins read own admin row"
on public.platform_admin_users
for select
to authenticated
using (coalesce(auth_user_id, user_id) = auth.uid());

commit;
