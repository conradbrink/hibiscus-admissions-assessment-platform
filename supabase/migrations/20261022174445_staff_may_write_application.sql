-- May this member of staff still act on this application?
--
-- An assisted registration (`startAssistedRegistration`, 22 October 2026)
-- runs on the parent's cookie, not the staff sign-in, for up to an hour.
-- Nothing in that hour asked whether the person who opened it could still
-- act: a role cut to read-only, or the campus taken away, and they could go
-- on saving sections, uploading documents and witnessing signatures until the
-- cookie ran out. The registration pages now ask this on every page and save.
--
-- `has_permission` and `can_access_campus` answer for `auth.uid()`, and the
-- parent pages run as the service role with no user at all, so this answers
-- the same two questions for a named member of staff. The bodies are those
-- two functions' rules, word for word, with the person passed in; case 84 of
-- the security suite proves the three agree for every fixture user, so a
-- change to either rule that is not made here fails the build.
--
-- `can_access_campus` itself is left as it is rather than rewritten to call
-- this: it runs inside every row-level policy, and a security definer
-- function is never inlined, so wrapping it would add a call per row read.
--
-- Service role only: a signed-in member of staff has no business asking it
-- about somebody else.

create or replace function public.staff_may_write_application(p_staff_id uuid, p_application_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
           select 1
             from public.staff_roles sr
             join public.role_permissions rp on rp.role_id = sr.role_id
             join public.staff_profiles sp on sp.id = sr.staff_id
            where sr.staff_id = p_staff_id
              and sp.is_active
              and rp.permission_code in ('applications.write', 'admin')
         )
     and exists (
           select 1
             from public.applications a
            where a.id = p_application_id
              and case
                    when exists (select 1 from public.staff_campuses where staff_id = p_staff_id)
                      then exists (select 1 from public.staff_campuses where staff_id = p_staff_id and campus_id = a.campus_id)
                    when exists (
                        select 1
                          from public.staff_roles sr
                          join public.roles r on r.id = sr.role_id
                         where sr.staff_id = p_staff_id and r.campus_scoped
                      )
                      then false
                    else true
                  end
         )
$$;

revoke execute on function public.staff_may_write_application(uuid, uuid) from public, anon, authenticated;
grant execute on function public.staff_may_write_application(uuid, uuid) to service_role;
