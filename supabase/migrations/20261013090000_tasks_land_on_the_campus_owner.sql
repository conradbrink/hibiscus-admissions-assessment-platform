-- Every task lands on somebody's list: the family's owner, or the campus's.
--
-- Since 25 September every campus names one person, and every new
-- application at that campus is theirs (`applications_set_default_owner`).
-- Tasks never followed. The engine names an assignee in two places only (the
-- call after a deferral, and the marking of a sitting), the staff forms offer
-- "Nobody yet", and the first-day checklist passes nobody at all. Work like
-- that sat under "Unassigned" until somebody happened to look. On 13 October
-- 2026 the school asked for tasks to go to the staff allocated to each
-- campus, automatically, and for the open tasks nobody had to be handed out
-- the same way.
--
-- ---------------------------------------------------------------------------
-- The rule, in order
-- ---------------------------------------------------------------------------
--
--   1. An assignee given explicitly is kept. A person's choice, or the
--      engine's (an assessor marks the sitting they ran), outranks a default.
--   2. A task about an applicant goes to the applicant's owner. That is the
--      campus owner unless somebody handed the family to a colleague, and
--      then the family's tasks should follow the colleague. A task about a
--      child goes to whoever owned the application they arrived on, as
--      `ownerForStudent` (web/lib/onboarding/owner.ts) already does for the
--      onboarding tasks.
--   3. Otherwise it goes to the owner of its campus: the task's own campus,
--      else the applicant's, else the child's current one.
--
-- Each step names only somebody who can still sign in, as the application
-- trigger does: a person who has left must not collect a queue nobody reads.
-- When nobody qualifies, the task stays unassigned, as before.
--
-- The rule is one function, `tasks_default_assignee`, so that the trigger and
-- the hand-out below cannot come to disagree.
--
-- ---------------------------------------------------------------------------
-- Why a trigger
-- ---------------------------------------------------------------------------
--
-- The same reason as the application owners. Tasks are written by
-- `commit_transition`, by three staff forms, by the CRM and its automations,
-- by the onboarding and first-day automations, by the extras settlement and
-- by inbound messages. A default in one of them leaves the others
-- unassigned, and so would the next writer somebody adds. A `before insert`
-- trigger covers all of them, including the ones not written yet.
--
-- ---------------------------------------------------------------------------
-- The open tasks already on file
-- ---------------------------------------------------------------------------
--
-- Handed out by the same rule, once, at the end of this migration: every
-- open task with nobody on it. Finished and cancelled tasks are left alone,
-- because closed work on somebody's list reads as work they did. This is
-- unlike the unowned applications in September, which the school wanted
-- left as they were: these are live work that nobody is holding.
--
-- What it deliberately does not do: anything on update. Unassigning a task
-- by hand still leaves it unassigned, and giving an applicant a new owner
-- does not move the open tasks they already have.

-- ---------------------------------------------------------------------------
-- 1. The rule
-- ---------------------------------------------------------------------------

create or replace function public.tasks_default_assignee(
  p_application_id uuid,
  p_student_id uuid,
  p_campus_id uuid
)
returns uuid
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_who uuid;
  v_campus uuid := p_campus_id;
begin
  -- The family's owner, while they can sign in.
  if p_application_id is not null then
    select a.owner_staff_id
      into v_who
      from public.applications a
      join public.staff_profiles sp on sp.id = a.owner_staff_id and sp.is_active
     where a.id = p_application_id;
  elsif p_student_id is not null then
    select a.owner_staff_id
      into v_who
      from public.students s
      join public.applications a on a.id = s.origin_application_id
      join public.staff_profiles sp on sp.id = a.owner_staff_id and sp.is_active
     where s.id = p_student_id;
  end if;
  if v_who is not null then
    return v_who;
  end if;

  -- Otherwise the campus owner, while they can sign in.
  if v_campus is null and p_application_id is not null then
    select a.campus_id into v_campus from public.applications a where a.id = p_application_id;
  end if;
  if v_campus is null and p_student_id is not null then
    select s.current_campus_id into v_campus from public.students s where s.id = p_student_id;
  end if;
  if v_campus is null then
    return null;
  end if;

  select c.default_owner_staff_id
    into v_who
    from public.campuses c
    join public.staff_profiles sp on sp.id = c.default_owner_staff_id and sp.is_active
   where c.id = v_campus;
  return v_who;
end $$;

comment on function public.tasks_default_assignee(uuid, uuid, uuid) is
  'Who a task with no assignee goes to: the family''s owner, else the owner of its campus, naming only staff who can sign in. Null when nobody qualifies.';

-- Not an API. The trigger below calls it with the definer's rights, and the
-- hand-out runs as the migration; nobody else needs to ask who owns a family
-- or a campus this way.
revoke all on function public.tasks_default_assignee(uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The trigger
-- ---------------------------------------------------------------------------

create or replace function public.tasks_set_default_assignee()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Only ever fills a blank.
  if new.assignee_staff_id is null then
    new.assignee_staff_id := public.tasks_default_assignee(new.application_id, new.student_id, new.campus_id);
  end if;
  return new;
end $$;

comment on function public.tasks_set_default_assignee() is
  'Gives a new task with no assignee to tasks_default_assignee. Never overrides an assignee given explicitly.';

-- A trigger function is not an API. It runs as definer so that a task opened
-- under a staff member's own rights can still read the campus and the
-- applicant it names, which makes it worth calling directly if anybody could,
-- so nobody can. The security suite fails the build without this (case 59).
revoke all on function public.tasks_set_default_assignee() from public, anon, authenticated;

drop trigger if exists tasks_set_default_assignee on public.tasks;
create trigger tasks_set_default_assignee
  before insert on public.tasks
  for each row execute function public.tasks_set_default_assignee();

comment on column public.campuses.default_owner_staff_id is
  'Who new applications and new unassigned tasks at this campus go to. Applications: applications_set_default_owner, on insert, only when no owner was given. Tasks: tasks_set_default_assignee, on insert, after the family''s own owner. Both only while that staff profile is active.';

-- ---------------------------------------------------------------------------
-- 3. The open tasks already on file
-- ---------------------------------------------------------------------------

do $$
declare
  v_handed integer;
  v_left integer;
begin
  with picked as (
    select t.id, public.tasks_default_assignee(t.application_id, t.student_id, t.campus_id) as who
      from public.tasks t
     where t.status = 'open'
       and t.assignee_staff_id is null
  )
  update public.tasks t
     set assignee_staff_id = p.who
    from picked p
   where t.id = p.id
     and p.who is not null;
  get diagnostics v_handed = row_count;

  select count(*) into v_left from public.tasks where status = 'open' and assignee_staff_id is null;

  -- Named as numbers because there is nothing to fix in either: a task left
  -- over belongs to a campus with no active owner, which Settings ->
  -- Campuses can change.
  raise notice '% open tasks handed out; % left unassigned because their campus has no active owner', v_handed, v_left;
end $$;
