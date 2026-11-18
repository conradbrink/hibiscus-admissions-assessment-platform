-- The row-level helpers, rewritten in PL/pgSQL so a nested call stops paying
-- for a fresh query plan every time.
--
-- Staff said the site was very slow. On 18 November 2026, production's
-- pg_stat_statements showed that the CRM's reads were the slow ones in the
-- database itself. A plain `select id, family_code from families` took
-- 1.7 seconds for a campus administrator and averaged 2.1 seconds over 401
-- calls. `crm_dashboard_counts()` averaged 3 seconds. The CRM family list
-- (`v_crm_family_facts`) took up to 7 seconds. The tables hold a few hundred
-- rows each.
--
-- The cause is how Postgres runs a SQL-language function that it cannot
-- inline. A `security definer` function is never inlined. A non-inlined
-- SQL function keeps its query plan only on the caller's own expression
-- node. So `can_access_family()` called once per row from a policy kept its
-- own plan, but the `has_permission()` and `can_access_campus()` calls
-- inside it are new nodes on every call. Each one was parsed and planned
-- again for every family row, about 2 ms per row on production. A PL/pgSQL
-- function keeps its compiled body and saved plans for the life of the
-- connection, so a nested call costs only the lookup.
--
-- Measured on a local replay with 792 families, 300 students and one staff
-- member per role (production is about three times slower):
--
--   families, campus administrator    605 ms ->  99 ms
--   families, super administrator     331 ms ->  38 ms
--   contacts, campus administrator    628 ms ->  83 ms
--   v_crm_family_facts, first 50      642 ms -> 201 ms
--   crm_dashboard_counts(null)        516 ms -> 248 ms
--
-- Reads that call `can_access_campus()` directly from a policy, such as
-- applications, bookings and `dashboard_counts()`, were already planned once
-- per statement. They measured the same within noise either way.
--
-- What does not change, and must not:
--
--   * The rules. Each body asks the same questions of the same tables as
--     the SQL it replaces, line for line. `has_permission` and
--     `can_access_campus` are named in the HR repository's
--     ADMISSIONS-CONTRACT.md. Their names, arguments, results, volatility,
--     `security definer` and pinned `search_path` are all as before.
--     `staff_may_write_application()` still mirrors the two rules, and
--     security suite case 84 still proves it.
--   * Grants. `create or replace` keeps the function's oid and its ACL, so
--     every policy, view and caller keeps working without being touched.
--
-- Do not turn these back into `language sql` to make them shorter. That
-- is how they were, and it is what made the CRM slow. `can_grant_role()`
-- and `current_staff_id()` stay SQL. The first only runs on the roles
-- screen. The second takes no argument and is always called as
-- `(select current_staff_id())`, so it runs once per statement.

create or replace function public.has_permission(p_code text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1
    from public.staff_roles sr
    join public.role_permissions rp on rp.role_id = sr.role_id
    join public.staff_profiles sp on sp.id = sr.staff_id
    where sr.staff_id = auth.uid()
      and sp.is_active
      and rp.permission_code in (p_code, 'admin')
  );
end;
$$;

-- Fails closed, exactly as `campus_scope_hardening` made it: a person with
-- campuses listed sees those; a person in a campus-scoped role with none
-- listed sees nothing; everyone else sees every campus.
create or replace function public.can_access_campus(p_campus_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.staff_campuses where staff_id = auth.uid()) then
    return exists (
      select 1 from public.staff_campuses
      where staff_id = auth.uid() and campus_id = p_campus_id
    );
  end if;

  if exists (
    select 1
    from public.staff_roles sr
    join public.roles r on r.id = sr.role_id
    where sr.staff_id = auth.uid() and r.campus_scoped
  ) then
    return false;
  end if;

  return true;
end;
$$;

-- A family is reached through a child, an application or the family's own
-- campus, any of which the caller may see.
create or replace function public.can_access_family(p_family_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_family_id is null then
    return false;
  end if;

  return (
      public.has_permission('students.read')
      and exists (
        select 1 from public.students s
         where s.family_id = p_family_id
           and public.can_access_campus(s.current_campus_id)
      )
    )
    or (
      public.has_permission('applications.read')
      and exists (
        select 1 from public.contacts c
          join public.applications a on a.contact_id = c.id
         where c.family_id = p_family_id
           and public.can_access_campus(a.campus_id)
      )
    )
    or (
      public.has_permission('crm.read')
      and exists (
        select 1 from public.families f
         where f.id = p_family_id
           and f.campus_id is not null
           and public.can_access_campus(f.campus_id)
      )
    );
end;
$$;

create or replace function public.can_edit_family(p_family_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_family_id is null then
    return false;
  end if;

  return (
      public.has_permission('crm.write')
      and exists (
        select 1 from public.families f
         where f.id = p_family_id
           and f.campus_id is not null
           and public.can_access_campus(f.campus_id)
      )
    )
    or (
      public.has_permission('students.write')
      and exists (
        select 1 from public.students s
         where s.family_id = p_family_id
           and public.can_access_campus(s.current_campus_id)
      )
    );
end;
$$;

create or replace function public.can_access_student(p_student_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  return exists (
    select 1 from public.students s
     where s.id = p_student_id
       and public.can_access_campus(s.current_campus_id)
  );
end;
$$;
