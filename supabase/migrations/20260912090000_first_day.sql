-- The first day.
--
-- Three messages and a check-in already surround a child's start date. What
-- was missing is the morning itself: somebody at the campus knowing, before
-- the gate opens, exactly who is new today — and a record afterwards that each
-- of them was actually greeted rather than left to find their own way in.
--
-- Both halves are deliberately internal. Nothing here sends a family anything,
-- so none of it is gated on `onboarding_journey_enabled`: a school that has
-- not turned the messages on still wants the list on the morning.

-- ---------------------------------------------------------------------------
-- A task about a campus
-- ---------------------------------------------------------------------------

-- `tasks_has_a_subject` was added with `tasks.student_id` and said a task must
-- name an application or a child. The morning list names neither: it is one
-- job, for one campus, about everyone starting there today. Splitting it per
-- child would put four near-identical reminders in four badges and still leave
-- nobody holding the list.
--
-- So the rule becomes what it always meant — a task must be about *something*
-- actionable — with a campus admitted as the third kind of subject. It is not
-- a loosening in practice: `tasks_select` already scopes on `campus_id`, so a
-- campus-only task is scoped by the policy that is already there, and a task
-- with no subject at all is still refused.
alter table public.tasks drop constraint if exists tasks_has_a_subject;
alter table public.tasks add constraint tasks_has_a_subject
  check (application_id is not null or student_id is not null or campus_id is not null);

comment on constraint tasks_has_a_subject on public.tasks is
  'A task must be about something: an applicant, a child, or a campus. A task about nothing is a task nobody can act on.';

-- One morning list per campus per first day, however many times the drain
-- runs. `due_at` is derived from the start date and the campus's arrival time,
-- so it is the same constant on every sweep of that day — which is what makes
-- this index, rather than a read-then-write, the thing that stops a duplicate
-- when two drains overlap.
create unique index if not exists tasks_one_first_day_welcome_idx
  on public.tasks(campus_id, due_at)
  where type = 'welcome_new_starters';

-- ---------------------------------------------------------------------------
-- A record that each child was welcomed
-- ---------------------------------------------------------------------------

-- A staff step rather than a second mechanism: the board at
-- `/staff/onboarding` then shows it per child for free, beside allocating the
-- class and sending the pack, and the office ticks it the same way.
--
-- `due_offset_days = 0` — the first day itself. Required, because "did anybody
-- actually greet this child" is not an optional question.
insert into public.onboarding_steps (code, label, description, owner, kind, required, sort_order, due_offset_days, reminder_offsets_days)
values
  ('welcomed_on_first_day', 'Welcome the child on their first morning',
   'Someone met them at the gate, showed them their class and knows their name. Tick it once it has happened.',
   'staff', 'action', true, 120, 0, '{}')
on conflict (code) do nothing;
