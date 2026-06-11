-- Company admins can view active/recent app sessions for their company.
-- Users still manage only their own sessions.

begin;

drop policy if exists "owners read own company app sessions"
on public.user_app_sessions;

create policy "owners read own company app sessions"
on public.user_app_sessions
for select
to authenticated
using (
  exists (
    select 1
    from public.company_memberships cm
    where cm.company_id = user_app_sessions.company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('owner', 'admin')
  )
  or public.loopbase_is_platform_admin()
);

commit;
