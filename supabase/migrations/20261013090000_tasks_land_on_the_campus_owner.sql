-- Every new task lands on somebody's list: the family's owner, or the
-- campus's.
--
-- Since 25 September every campus names one person, and every new
-- application at that campus is theirs (`applications_set_default_owner`).
-- Tasks never followed. The engine names an assignee in two places only (the
-- call after a deferral, and the marking of a sitting), the staff forms offer
-- "Nobody yet", and the first-day checklist passes nobody at all. Work like
-- that sat under "Unassigned" until somebody happened to look. On 13 October
-- 2026 the school asked for tasks to go to the staff allocated to each
-- campus, automatically.
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
-- What it deliberately does not do
-- ---------------------------------------------------------------------------
--
--   * **No backfill.** Tasks already open and unassigned stay as they are, as
--     the unowned applications were left in September. Handing them out is
--     the school's decision, and is one update when they make it.
--   * **Nothing on update.** Unassigning a task by hand still leaves it
--     unassigned, and giving an applicant a new owner does not move the open
--     tasks they already have.

create or replace function public.tasks_set_default_assignee()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campus uuid;
begin
  -- 1. Only ever fills a blank.
  if new.assignee_staff_id is not null then
    return new;
  end if;

  -- 2. The family's owner, while they can sign in.
  if new.application_id is not null then
    select a.owner_staff_id
      into new.assignee_staff_id
      from public.applications a
      join public.staff_profiles sp on sp.id = a.owner_staff_id and sp.is_active
     where a.id = new.application_id;
  elsif new.student_id is not null then
    select a.owner_staff_id
      into new.assignee_staff_id
      from public.students s
      join public.applications a on a.id = s.origin_application_id
      join public.staff_profiles sp on sp.id = a.owner_staff_id and sp.is_active
     where s.id = new.student_id;
  end if;

  -- 3. The campus owner, while they can sign in.
  if new.assignee_staff_id is null then
    v_campus := new.campus_id;
    if v_campus is null and new.application_id is not null then
      select a.campus_id into v_campus from public.applications a where a.id = new.application_id;
    end if;
    if v_campus is null and new.student_id is not null then
      select s.current_campus_id into v_campus from public.students s where s.id = new.student_id;
    end if;
    if v_campus is not null then
      select c.default_owner_staff_id
        into new.assignee_staff_id
        from public.campuses c
        join public.staff_profiles sp on sp.id = c.default_owner_staff_id and sp.is_active
       where c.id = v_campus;
    end if;
  end if;

  return new;
end $$;

comment on function public.tasks_set_default_assignee() is
  'Gives a new task with no assignee to the family''s owner, else to the owner of its campus, naming only staff who can sign in. Never overrides an assignee given explicitly.';

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
