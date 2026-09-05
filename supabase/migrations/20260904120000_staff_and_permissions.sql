-- Staff, roles, permissions, and the audit log.
--
-- Permission-native from the first migration. The merchandising app carries a
-- role-string layer it is still migrating off, and its own notes record that
-- the transitional `role = 'manager' or has_permission(…)` form was a mistake:
-- a permission you cannot take away is not a permission. Here a member of
-- staff holds roles, a role is a bundle of permission codes, and every policy
-- in the schema asks one question — `has_permission(code)`.
--
-- Parents are not in this file and are not in `auth.users` at all. They reach
-- their application through a magic link, and every parent-facing query runs
-- under the service role after that link has been verified. See
-- 20260904120300_access_tokens.sql.

-- ---------------------------------------------------------------------------
-- Shared trigger
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- A trigger function consults no EXECUTE privilege when it fires, so revoking
-- this costs nothing and closes the class of "somebody calls it by hand".
revoke all on function public.set_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------

create table if not exists public.staff_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.staff_profiles is
  'One row per member of staff who can sign in. Accounts are created by an administrator; there is no self-registration.';

drop trigger if exists staff_profiles_set_updated_at on public.staff_profiles;
create trigger staff_profiles_set_updated_at
  before update on public.staff_profiles
  for each row execute function public.set_updated_at();

-- ⚠️ There is deliberately NO trigger on auth.users creating a staff_profiles
-- row. A self-registered account therefore has no profile, no roles, and no
-- permissions, and every policy denies it. If a trigger is ever added here,
-- public sign-up becomes a way into the admissions console.

create table if not exists public.permissions (
  code text primary key,
  label text not null,
  sort_order int not null default 0
);

comment on table public.permissions is
  'The catalogue of permission codes. Mirrors web/lib/permissions.ts exactly; the database is the authority.';

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  -- System roles may be edited but not deleted, so nobody can remove the
  -- last role that holds `admin` and lock everyone out.
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists roles_set_updated_at on public.roles;
create trigger roles_set_updated_at
  before update on public.roles
  for each row execute function public.set_updated_at();

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_id, permission_code)
);

create table if not exists public.staff_roles (
  staff_id uuid not null references public.staff_profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  primary key (staff_id, role_id)
);

create index if not exists staff_roles_role_idx on public.staff_roles(role_id);

-- ---------------------------------------------------------------------------
-- Helpers every policy funnels through
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER so a policy on another table can look up the caller's
-- permissions without recursively hitting these tables' own RLS. Each pins
-- search_path and only ever answers for `auth.uid()`, so an anonymous caller
-- gets null or false and nothing leaks.

create or replace function public.current_staff_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.staff_profiles where id = auth.uid() and is_active
$$;

-- `admin` satisfies everything, so no policy has to write
-- `has_permission('x') or has_permission('admin')` — and none can forget to.
-- A deactivated member of staff gets false for every code.
create or replace function public.has_permission(p_code text)
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
    where sr.staff_id = auth.uid()
      and sp.is_active
      and rp.permission_code in (p_code, 'admin')
  )
$$;

-- What the proxy asks on every staff request, so the proxy and RLS read the
-- same answer from the same place.
create or replace function public.my_permissions()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct rp.permission_code), '{}'::text[])
  from public.staff_roles sr
  join public.role_permissions rp on rp.role_id = sr.role_id
  join public.staff_profiles sp on sp.id = sr.staff_id
  where sr.staff_id = auth.uid()
    and sp.is_active
$$;

revoke execute on function public.current_staff_id() from public, anon;
revoke execute on function public.has_permission(text) from public, anon;
revoke execute on function public.my_permissions() from public, anon;
grant execute on function public.current_staff_id() to authenticated;
grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.my_permissions() to authenticated;

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

-- bigint identity rather than uuid, deliberately: this is an append-only log
-- and callers order by it. Two rows in the same millisecond still have a
-- definite order, which `occurred_at` alone cannot promise.
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_type text not null check (actor_type in ('staff', 'parent', 'system')),
  actor_id uuid,
  -- A readable identity for the timeline: an email for staff, "Parent (via
  -- link)" for a parent. Never the parent's own details.
  actor_label text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  -- Denormalised so the applicant's Audit tab is one indexed read. No foreign
  -- key: the log must outlive the row it describes.
  application_id uuid,
  before jsonb,
  after jsonb,
  ip_hash text,
  occurred_at timestamptz not null default now()
);

create index if not exists audit_log_application_idx
  on public.audit_log(application_id, id desc);
create index if not exists audit_log_entity_idx
  on public.audit_log(entity_type, entity_id);

comment on table public.audit_log is
  'Append-only. Written explicitly by the workflow engine and server actions under the service role, and by trigger for direct staff edits. No role may update or delete a row.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.staff_profiles enable row level security;
alter table public.permissions enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.staff_roles enable row level security;
alter table public.audit_log enable row level security;

-- Every signed-in member of staff can see who their colleagues are: names
-- appear as owners and assessors throughout the console.
drop policy if exists staff_profiles_select on public.staff_profiles;
create policy staff_profiles_select on public.staff_profiles
  for select using ((select public.current_staff_id()) is not null);

drop policy if exists staff_profiles_update on public.staff_profiles;
create policy staff_profiles_update on public.staff_profiles
  for update using (
    id = (select auth.uid())
    or (select public.has_permission('staff.write'))
  );

-- Inserting a profile means creating an account, which only the service role
-- does (see the staff invite route). No insert policy for authenticated.

drop policy if exists permissions_select on public.permissions;
create policy permissions_select on public.permissions
  for select using ((select public.current_staff_id()) is not null);

drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles
  for select using ((select public.current_staff_id()) is not null);

drop policy if exists roles_insert on public.roles;
create policy roles_insert on public.roles
  for insert with check ((select public.has_permission('staff.write')));

drop policy if exists roles_update on public.roles;
create policy roles_update on public.roles
  for update using ((select public.has_permission('staff.write')));

drop policy if exists roles_delete on public.roles;
create policy roles_delete on public.roles
  for delete using ((select public.has_permission('staff.write')) and not is_system);

drop policy if exists role_permissions_select on public.role_permissions;
create policy role_permissions_select on public.role_permissions
  for select using ((select public.current_staff_id()) is not null);

drop policy if exists role_permissions_insert on public.role_permissions;
create policy role_permissions_insert on public.role_permissions
  for insert with check ((select public.has_permission('staff.write')));

drop policy if exists role_permissions_delete on public.role_permissions;
create policy role_permissions_delete on public.role_permissions
  for delete using ((select public.has_permission('staff.write')));

drop policy if exists staff_roles_select on public.staff_roles;
create policy staff_roles_select on public.staff_roles
  for select using ((select public.current_staff_id()) is not null);

drop policy if exists staff_roles_insert on public.staff_roles;
create policy staff_roles_insert on public.staff_roles
  for insert with check ((select public.has_permission('staff.write')));

drop policy if exists staff_roles_delete on public.staff_roles;
create policy staff_roles_delete on public.staff_roles
  for delete using ((select public.has_permission('staff.write')));

-- Audit: readable with the permission, and that is all. Inserts come from
-- the service role and from triggers; no update or delete policy exists for
-- anyone. An audit log a user can edit is not an audit log.
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select using ((select public.has_permission('audit.read')));

-- ---------------------------------------------------------------------------
-- Seed: permissions and system roles
-- ---------------------------------------------------------------------------

insert into public.permissions (code, label, sort_order) values
  ('admin',                    'Full administrative access',                                    0),
  ('applications.read',        'View applicants and the pipeline',                              10),
  ('applications.write',       'Edit applicants, book and reschedule',                          20),
  ('assessments.deliver',      'Run assessment days: check in, launch, mark no-shows',          30),
  ('assessments.score.write',  'Mark and amend assessment scores',                              40),
  ('assessments.author',       'Author questions, templates and benchmarks',                    50),
  ('offers.read',              'View offers and fee details',                                   60),
  ('offers.approve',           'Approve and send offers',                                       70),
  ('decisions.override',       'Override an admission decision, with a reason',                 80),
  ('finance.read',             'View payments',                                                 90),
  ('finance.write',            'Reconcile payments and issue refunds',                          100),
  ('rules.write',              'Change admission rules',                                        110),
  ('templates.write',          'Edit email and offer templates',                                120),
  ('staff.write',              'Manage staff accounts and roles',                               130),
  ('settings.write',           'Change campuses, grades, intakes and workflow settings',        140),
  ('analytics.read',           'View admissions analytics',                                     150),
  ('data.export',              'Export applicant data',                                         160),
  ('audit.read',               'Read the audit trail',                                          170)
on conflict (code) do update set label = excluded.label, sort_order = excluded.sort_order;

insert into public.roles (code, name, description, is_system) values
  ('super_admin',        'Super administrator', 'Everything, including rules, staff and settings.', true),
  ('admissions_manager', 'Admissions manager',  'Runs the pipeline, approves offers, overrides decisions with a reason.', true),
  ('admissions_staff',   'Admissions staff',    'Works the pipeline and assessment days. No finance, no rule changes.', true),
  ('assessor',           'Assessor',            'Assessment days and marking. No fee or offer visibility.', true),
  ('finance',            'Finance',             'Payments and fee schedules. Read-only on scores.', true),
  ('campus_admin',       'Campus administrator','Admissions staff scope, restricted to assigned campuses.', true),
  ('management',         'Management',          'Read-only pipeline and analytics.', true),
  ('content_author',     'Content author',      'Question banks and templates. No applicant access.', true)
on conflict (code) do update set name = excluded.name, description = excluded.description;

-- Grants per role. Written as a table so the whole matrix can be read at
-- once, which is how a mistake in it gets noticed.
with grants(role_code, permission_code) as (
  values
    ('super_admin', 'admin'),

    ('admissions_manager', 'applications.read'),
    ('admissions_manager', 'applications.write'),
    ('admissions_manager', 'assessments.deliver'),
    ('admissions_manager', 'offers.read'),
    ('admissions_manager', 'offers.approve'),
    ('admissions_manager', 'decisions.override'),
    ('admissions_manager', 'templates.write'),
    ('admissions_manager', 'analytics.read'),
    ('admissions_manager', 'data.export'),
    ('admissions_manager', 'audit.read'),

    ('admissions_staff', 'applications.read'),
    ('admissions_staff', 'applications.write'),
    ('admissions_staff', 'assessments.deliver'),
    ('admissions_staff', 'offers.read'),

    ('assessor', 'applications.read'),
    ('assessor', 'assessments.deliver'),
    ('assessor', 'assessments.score.write'),

    ('finance', 'applications.read'),
    ('finance', 'offers.read'),
    ('finance', 'finance.read'),
    ('finance', 'finance.write'),

    ('campus_admin', 'applications.read'),
    ('campus_admin', 'applications.write'),
    ('campus_admin', 'assessments.deliver'),
    ('campus_admin', 'offers.read'),

    ('management', 'applications.read'),
    ('management', 'analytics.read'),

    ('content_author', 'assessments.author')
)
insert into public.role_permissions (role_id, permission_code)
select r.id, g.permission_code
from grants g
join public.roles r on r.code = g.role_code
on conflict do nothing;
