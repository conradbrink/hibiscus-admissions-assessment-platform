-- A task somebody writes, rather than one the system opens.
--
-- Every task until now was raised by the engine: call this parent, mark this
-- sitting, send this outcome. There was no way for a person to write one down
-- — "ring the printer about the Phase 2 signage", "chase Block 7 for the
-- fire certificate" — so that work lived in somebody's notebook, and nobody
-- else could see it or pick it up.
--
-- Two things this needs from the schema, and neither is cosmetic.

-- ---------------------------------------------------------------------------
-- 1. Who may write one
-- ---------------------------------------------------------------------------

-- `tasks_insert` asked for `applications.write`, which is the wrong question
-- for this and, more to the point, the wrong answer: **Management holds no
-- write permission at all** — `applications.read`, `analytics.read`,
-- `audit.read`, `students.read` and nothing else. Reusing an applicant
-- permission to let them set a task would have handed them the applicant
-- record too.
--
-- So it gets its own, granted to the three roles the school named. The super
-- administrator needs no grant: `admin` satisfies every check.
insert into public.permissions (code, label, sort_order)
values ('tasks.write', 'Create tasks and assign them to staff', 61)
on conflict (code) do update set label = excluded.label;

insert into public.role_permissions (role_id, permission_code)
select r.id, 'tasks.write'
  from public.roles r
 where r.name in ('Admissions manager', 'Management')
on conflict do nothing;

-- Writing a task is now its own permission rather than a side effect of being
-- allowed to edit applicants.
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert with check (
    (select public.has_permission('tasks.write'))
    and (campus_id is null or (select public.can_access_campus(campus_id)))
    and created_by_type = 'staff'
    and created_by = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 2. Who may tick one off
-- ---------------------------------------------------------------------------

-- The person the task was given to. That is the whole point of assigning it,
-- and under the old policy a member of Management could be handed a task and
-- then be refused by the database when they tried to mark it done.
--
-- RLS cannot restrict which columns an update touches, so the assignee arm
-- technically lets them edit their own task's wording as well as its status.
-- That is a memo to themselves about work they own; the server action writes
-- only the completion columns, and every change is audited either way.
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update using (
    (campus_id is null or (select public.can_access_campus(campus_id)))
    and (
      (select public.has_permission('applications.write'))
      or (select public.has_permission('tasks.write'))
      or assignee_staff_id = (select auth.uid())
    )
  );

comment on column public.tasks.assignee_staff_id is
  'Whose task it is. Also grants that person the right to complete it, whatever else they may or may not do (tasks_update).';
