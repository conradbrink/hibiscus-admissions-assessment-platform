-- Campus scoping, closed fail-safe.
--
-- Phase 1 scoped every applicant table through can_access_campus(), whose
-- rule was "no staff_campuses rows means every campus". That is right for
-- head office and wrong for a campus administrator whose campus has not
-- been assigned yet: for a moment they saw the whole school. This migration
-- makes the rule depend on the role, scopes the audit log, and gives the
-- console one list of campuses a person may filter by.
--
-- Scoping stays orthogonal to role: an admissions_manager with a
-- staff_campuses row is a "campus admissions manager" who approves offers
-- for their own school only.

-- ---------------------------------------------------------------------------
-- Roles that must be assigned campuses
-- ---------------------------------------------------------------------------

alter table public.roles add column if not exists campus_scoped boolean not null default false;

comment on column public.roles.campus_scoped is
  'A holder of this role sees nothing until assigned campuses in staff_campuses. Head-office roles leave it false: no assignment means every campus.';

update public.roles set campus_scoped = true where code = 'campus_admin' and not campus_scoped;

comment on table public.staff_campuses is
  'Restricts a member of staff to named campuses. No rows means every campus for head-office roles, and nothing at all for a campus-scoped role (roles.campus_scoped) — a campus administrator without a campus is a configuration error that must fail closed, not open.';

-- ---------------------------------------------------------------------------
-- can_access_campus(): assigned campuses only; a campus-scoped role with no
-- assignment sees nothing; everyone else sees everything.
-- ---------------------------------------------------------------------------

create or replace function public.can_access_campus(p_campus_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (select 1 from public.staff_campuses where staff_id = auth.uid())
      then exists (
        select 1 from public.staff_campuses
        where staff_id = auth.uid() and campus_id = p_campus_id
      )
    when exists (
        select 1
        from public.staff_roles sr
        join public.roles r on r.id = sr.role_id
        where sr.staff_id = auth.uid() and r.campus_scoped
      )
      then false
    else true
  end
$$;

revoke execute on function public.can_access_campus(uuid) from public, anon;
grant execute on function public.can_access_campus(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The campuses a person may see. Every campus filter in the console reads
-- this rather than `campuses`, so a restricted person is not offered a
-- choice the policies would answer with an empty page.
-- ---------------------------------------------------------------------------

create or replace view public.v_accessible_campuses
with (security_invoker = true)
as
select c.*
from public.campuses c
where c.is_active
  and public.can_access_campus(c.id);

-- ---------------------------------------------------------------------------
-- Audit rows that belong to an application follow its campus. Rows with no
-- application (staff invited, a role changed) stay visible to audit.read.
-- ---------------------------------------------------------------------------

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select using (
    (select public.has_permission('audit.read'))
    and (
      audit_log.application_id is null
      or exists (
        select 1 from public.applications a
        where a.id = audit_log.application_id
          and (select public.can_access_campus(a.campus_id))
      )
    )
  );
