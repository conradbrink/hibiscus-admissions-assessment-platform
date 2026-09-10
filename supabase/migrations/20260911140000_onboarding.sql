-- What a family still has to do, and what the school still has to do for them.
--
-- The journey the school described runs: enrolled → welcome → finish the
-- checklist → join the class group → see the dates → first day. Most of that
-- is not a state machine. It is a set of errands that happen in whatever
-- order the family gets to them: a uniform size on Tuesday, the WhatsApp
-- group on Saturday, the transport form when the grandmother is asked.
--
-- So the checklist is independent items with a status, not a graph. A linear
-- machine would strand the family who did the fourth thing before the second,
-- and every one of them would then be "stuck" on a board that is wrong. The
-- only real state is `students.status`, which the enrolment already owns.
--
-- The list itself is data, seeded here from the school's own words, and edited
-- at /staff/admin/onboarding-steps. A step nobody at the school can change is
-- a step that will be wrong by February.

create table if not exists public.onboarding_steps (
  code text primary key check (code ~ '^[a-z0-9_]+$'),
  label text not null,
  description text,
  -- Who does it. A parent's steps show on their checklist; a staff step is
  -- the school's own promise — allocate the class, send the pack — and shows
  -- only on the board.
  owner text not null default 'parent' check (owner in ('parent', 'staff', 'either')),
  kind text not null default 'acknowledge' check (kind in (
    'acknowledge',  -- "I have read this"
    'choice',       -- pick from `options`: a uniform size, a transport route
    'upload',       -- a document, through the same door as every other
    'link',         -- go somewhere and come back: the class WhatsApp group
    'action'        -- the school does it; a person ticks it
  )),
  options jsonb not null default '[]'::jsonb,
  -- When the step is an upload, the requirement it satisfies, so a family is
  -- never asked twice for a paper they already gave us at registration.
  document_requirement_code text references public.document_requirements(code) on delete set null,
  required boolean not null default true,
  -- Null on both: every campus, every class. The same band convention as
  -- `document_requirements` and `fee_schedules`.
  campus_id uuid references public.campuses(id) on delete cascade,
  grade_sort_min int,
  grade_sort_max int,
  -- Days after the item is opened at which an unfinished one is chased.
  reminder_offsets_days int[] not null default '{}',
  -- Days after the child starts by which it should be done. Null: no date.
  due_offset_days int,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (grade_sort_min is null or grade_sort_max is null or grade_sort_max >= grade_sort_min)
);

drop trigger if exists onboarding_steps_set_updated_at on public.onboarding_steps;
create trigger onboarding_steps_set_updated_at
  before update on public.onboarding_steps
  for each row execute function public.set_updated_at();

comment on table public.onboarding_steps is
  'The editable list of what a newly enrolled family and the school each have to do. Independent items, not a sequence.';

create table if not exists public.student_onboarding_items (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  enrolment_id uuid references public.enrolments(id) on delete set null,
  -- Denormalised for the read policy, like `tasks.campus_id`.
  campus_id uuid not null references public.campuses(id) on delete restrict,
  step_code text not null references public.onboarding_steps(code) on delete restrict,
  status text not null default 'pending' check (status in (
    'pending', 'in_progress', 'done', 'not_applicable', 'blocked'
  )),
  -- The answer, when the step asks for one: {"size":"7-8"}, {"route":"Phakalane AM"}.
  value jsonb not null default '{}'::jsonb,
  document_id uuid references public.documents(id) on delete set null,
  note text,
  due_on date,
  completed_at timestamptz,
  completed_by text check (completed_by in ('parent', 'staff', 'system')),
  completed_by_staff_id uuid references public.staff_profiles(id) on delete set null,
  reminders_sent int not null default 0,
  last_reminder_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, step_code)
);

create index if not exists onboarding_items_student_idx on public.student_onboarding_items(student_id);
create index if not exists onboarding_items_open_idx
  on public.student_onboarding_items(campus_id, status) where status in ('pending', 'in_progress', 'blocked');

drop trigger if exists onboarding_items_set_updated_at on public.student_onboarding_items;
create trigger onboarding_items_set_updated_at
  before update on public.student_onboarding_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Opening a child's checklist
-- ---------------------------------------------------------------------------

-- Called at enrolment, and again whenever the school adds a step: idempotent,
-- so a new step reaches the children who are already onboarding and no
-- existing answer is touched.
create or replace function public.open_student_onboarding(p_student_id uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campus uuid;
  v_grade_sort int;
  v_enrolment uuid;
  v_starts date;
  v_added int;
begin
  select s.current_campus_id, g.sort_order
    into v_campus, v_grade_sort
    from public.students s
    left join public.grades g on g.id = s.current_grade_id
   where s.id = p_student_id;
  if v_campus is null then
    raise exception 'student_not_found';
  end if;

  select e.id, e.starts_on into v_enrolment, v_starts
    from public.enrolments e
   where e.student_id = p_student_id and e.status in ('pending', 'active')
   order by e.starts_on desc nulls last
   limit 1;

  insert into public.student_onboarding_items (student_id, enrolment_id, campus_id, step_code, due_on)
  select p_student_id, v_enrolment, v_campus, st.code,
         case when st.due_offset_days is not null and v_starts is not null
              then v_starts + st.due_offset_days
         end
    from public.onboarding_steps st
   where st.is_active
     and (st.campus_id is null or st.campus_id = v_campus)
     -- A child with no grade yet gets the steps that apply to everyone.
     and (st.grade_sort_min is null or (v_grade_sort is not null and v_grade_sort >= st.grade_sort_min))
     and (st.grade_sort_max is null or (v_grade_sort is not null and v_grade_sort <= st.grade_sort_max))
  on conflict (student_id, step_code) do nothing;

  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

revoke execute on function public.open_student_onboarding(uuid) from public, anon, authenticated;

comment on function public.open_student_onboarding(uuid) is
  'Opens the checklist items that apply to this child. Idempotent: a step added later reaches children already onboarding, and no answer is touched.';

-- ---------------------------------------------------------------------------
-- The school's own list, in its own words
-- ---------------------------------------------------------------------------

insert into public.onboarding_steps (code, label, description, owner, kind, required, sort_order, due_offset_days, reminder_offsets_days) values
  ('welcome_read', 'Read the welcome message',
   'What happens between now and the first day.', 'parent', 'acknowledge', true, 10, null, '{}'),
  ('confirm_details', 'Check your details are right',
   'Names, mobile numbers and who we should call in an emergency.', 'parent', 'acknowledge', true, 20, -14, '{7}'),
  ('medical_update', 'Tell us about allergies, medication or conditions',
   'Anything the class teacher and the office should know on the first day.', 'parent', 'acknowledge', true, 30, -14, '{7}'),
  ('photo_consent', 'Photographs and video',
   'Whether we may photograph your child for school newsletters and social media.', 'parent', 'choice', true, 40, -14, '{7}'),
  ('uniform', 'Uniform sizes',
   'So the shop can have it ready rather than measuring on the first morning.', 'parent', 'choice', true, 50, -21, '{10,3}'),
  ('book_pack', 'Book and stationery pack',
   'Whether you would like the school to put the pack together.', 'parent', 'choice', false, 60, -21, '{10}'),
  ('transport', 'Transport',
   'Whether your child will use school transport, and from where.', 'parent', 'choice', false, 70, -21, '{10}'),
  ('whatsapp_group', 'Join the class WhatsApp group',
   'Where the class teacher shares the day-to-day things.', 'parent', 'link', false, 80, null, '{7,2}'),
  ('first_day_read', 'Read the first-day instructions',
   'Where to go, what to bring, and what time.', 'parent', 'acknowledge', true, 90, -3, '{2}'),
  ('class_allocated', 'Allocate the class and teacher',
   'The school does this, then the family can be told.', 'staff', 'action', true, 100, -14, '{}'),
  ('welcome_pack_sent', 'Send the welcome pack',
   'The school does this.', 'staff', 'action', false, 110, -14, '{}')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Who may see and change a checklist
-- ---------------------------------------------------------------------------

alter table public.onboarding_steps enable row level security;
alter table public.student_onboarding_items enable row level security;

-- The list is reference data: anyone who may read the register reads it, and
-- changing it is a settings change like the document requirements beside it.
drop policy if exists onboarding_steps_select on public.onboarding_steps;
create policy onboarding_steps_select on public.onboarding_steps
  for select using ((select public.has_permission('students.read')));

drop policy if exists onboarding_steps_insert on public.onboarding_steps;
create policy onboarding_steps_insert on public.onboarding_steps
  for insert with check ((select public.has_permission('settings.write')));

drop policy if exists onboarding_steps_update on public.onboarding_steps;
create policy onboarding_steps_update on public.onboarding_steps
  for update using ((select public.has_permission('settings.write')));

drop policy if exists onboarding_items_select on public.student_onboarding_items;
create policy onboarding_items_select on public.student_onboarding_items
  for select using (
    (select public.has_permission('students.read'))
    and (select public.can_access_campus(student_onboarding_items.campus_id))
  );

-- Ticking an item off on a family's behalf is ordinary register work.
drop policy if exists onboarding_items_update on public.student_onboarding_items;
create policy onboarding_items_update on public.student_onboarding_items
  for update using (
    (select public.has_permission('students.write'))
    and (select public.can_access_campus(student_onboarding_items.campus_id))
  );

-- No insert policy: a checklist is opened by `open_student_onboarding` from
-- the active list, or it is not the same checklist as everyone else's. No
-- delete policy: a step that did not get done is the finding.
