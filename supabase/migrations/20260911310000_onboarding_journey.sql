-- The onboarding journey: four messages, and somewhere for staff work to live.
--
-- A family that accepts a place has been getting one email at enrolment and
-- then silence until their child walks through the gate. The checklist has
-- been there the whole time; nothing has ever told a family to go back to it,
-- and nothing has told a member of staff to do their half.
--
-- Three messages before the start date and one after, anchored on
-- `enrolments.starts_on`. The schedule lives in `lib/onboarding/schedule.ts`
-- where it can be argued with by a test rather than by a parent.

-- ---------------------------------------------------------------------------
-- A task that is about a child rather than an application
-- ---------------------------------------------------------------------------

-- Onboarding work happens after the application is terminal, so every task it
-- needs — allocate a class, greet the new starters, answer a parent who
-- replied — has had nowhere to live. `tasks.application_id` is already
-- nullable; this gives the other subject a column.
--
-- No new RPC: `tasks_select` scopes on `tasks.campus_id` directly rather than
-- joining through the application, so a student task that carries its campus
-- is scoped correctly by the policy that is already there. The service role
-- writes it, exactly as `commit_transition` does.
alter table public.tasks
  add column if not exists student_id uuid references public.students(id) on delete cascade;

create index if not exists tasks_student_idx
  on public.tasks(student_id) where student_id is not null and status = 'open';

comment on column public.tasks.student_id is
  'The child this task is about, for work after enrolment. Exactly one of application_id and student_id is set.';

-- A task about nothing is a task nobody can act on. Existing rows all carry an
-- application, so this is safe to add now and stops the next caller forgetting.
alter table public.tasks drop constraint if exists tasks_has_a_subject;
alter table public.tasks add constraint tasks_has_a_subject
  check (application_id is not null or student_id is not null);

-- ---------------------------------------------------------------------------
-- What time the day starts
-- ---------------------------------------------------------------------------

-- There has been no start-of-day time anywhere in the system, and the
-- first-day message is unsendable without one. Per campus, beside the address
-- and the phone numbers, because Block 7 and Bana Tlokweng do not start at the
-- same hour.
alter table public.campuses
  add column if not exists first_day_arrival_time time;

comment on column public.campuses.first_day_arrival_time is
  'What time a new family should arrive on the first day. Null: the first-day message omits the line rather than inventing one.';

-- ---------------------------------------------------------------------------
-- What the family has already been sent
-- ---------------------------------------------------------------------------

-- The sweep needs to know which of the four moments a child has had, and the
-- job queue is the wrong place to ask: its rows are pruned, and "has this
-- family been welcomed" is a question the school will ask long after the job
-- is gone.
create table if not exists public.student_journey_messages (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  step text not null check (step in ('welcome', 'outstanding', 'first_day', 'first_week')),
  sent_at timestamptz not null default now(),
  unique (student_id, step)
);

create index if not exists student_journey_student_idx
  on public.student_journey_messages(student_id);

comment on table public.student_journey_messages is
  'One row per onboarding moment a child''s family has been sent. The unique key is what stops a redelivered sweep writing twice.';

alter table public.student_journey_messages enable row level security;

-- Visible with the child. Written by the sweep under the service role only,
-- like every other record the drain keeps.
drop policy if exists student_journey_select on public.student_journey_messages;
create policy student_journey_select on public.student_journey_messages
  for select using (
    exists (
      select 1 from public.students s
      where s.id = student_journey_messages.student_id
    )
  );

-- ---------------------------------------------------------------------------
-- The switch
-- ---------------------------------------------------------------------------

-- Ships off, like the re-enrolment asks did. The school should watch one
-- family go through by hand before the product starts writing to everyone who
-- enrols.
insert into public.settings (key, value, description)
values
  ('onboarding_journey_enabled', 'false'::jsonb,
   'Send the onboarding messages automatically: a welcome three weeks before a child starts, a reminder of what is outstanding, the first-day details, and a check-in at the end of the first week.'),
  ('parent_guide_url', '""'::jsonb,
   'Link to the parent guide sent with the onboarding welcome. Empty: the welcome omits the line rather than sending a broken link.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- The four emails
-- ---------------------------------------------------------------------------

-- Deliberately four and not six. Every extra message is one more chance for a
-- family to stop reading them, and a family who does everything promptly gets
-- three in total. The open question that would have been its own send is
-- folded into the first-day message instead.
--
-- No teacher or class name anywhere: the school asked for warm, not personal,
-- and naming a teacher would make the whole journey wait on class allocation.

insert into public.email_templates (key, version, name, description, subject, body_text, body_html, allowed_variables, is_active, audience)
values
(
  'onboarding_welcome', 1,
  'Onboarding: welcome',
  'Sent about three weeks before a child starts. Carries the parent guide and the checklist.',
  'Welcome to {{campus}} — {{student_first_name}} starts on {{start_date}}',
  'Dear {{parent_first_name}},

We are looking forward to welcoming {{student_first_name}} to {{campus}} in {{grade}}. They start on {{start_date}}.

There are a few things to sort out before then — uniform, transport, and some details we need from you. Everything is in one place:
{{onboarding_link}}

We have also put together a short guide for new families: what the day looks like, how to reach us, and what to do when your child is unwell.
{{guide_url}}

If anything is unclear, call the office on {{campus_phone}}.

Warm regards,
Hibiscus International Schools',
  '<p>Dear {{parent_first_name}},</p>'
  || '<p>We are looking forward to welcoming {{student_first_name}} to {{campus}} in {{grade}}. They start on <strong>{{start_date}}</strong>.</p>'
  || '<p>There are a few things to sort out before then — uniform, transport, and some details we need from you. Everything is in one place:</p>'
  || '<p><a href="{{onboarding_link}}">Get {{student_first_name}} ready</a></p>'
  || '<p>We have also put together a <a href="{{guide_url}}">short guide for new families</a>: what the day looks like, how to reach us, and what to do when your child is unwell.</p>'
  || '<p>If anything is unclear, call the office on {{campus_phone}}.</p>'
  || '<p>Warm regards,<br>Hibiscus International Schools</p>',
  array['parent_first_name', 'student_first_name', 'campus', 'grade', 'start_date', 'campus_phone', 'onboarding_link', 'guide_url'],
  true, 'family'
),
(
  'onboarding_outstanding', 1,
  'Onboarding: still to do',
  'Sent about ten days before a child starts, and only when something required is still outstanding.',
  '{{student_first_name}} starts on {{start_date}} — a few things to finish',
  'Dear {{parent_first_name}},

{{student_first_name}} starts at {{campus}} on {{start_date}}. Before then we still need:

{{outstanding_items}}

It takes a few minutes and you can do it on your phone:
{{onboarding_link}}

If anything is unclear, call the office on {{campus_phone}} and we will walk you through it.

Warm regards,
Hibiscus International Schools',
  '<p>Dear {{parent_first_name}},</p>'
  || '<p>{{student_first_name}} starts at {{campus}} on <strong>{{start_date}}</strong>. Before then we still need:</p>'
  || '<p style="white-space: pre-line">{{outstanding_items}}</p>'
  || '<p><a href="{{onboarding_link}}">Finish the checklist</a> — it takes a few minutes and you can do it on your phone.</p>'
  || '<p>If anything is unclear, call the office on {{campus_phone}} and we will walk you through it.</p>'
  || '<p>Warm regards,<br>Hibiscus International Schools</p>',
  array['parent_first_name', 'student_first_name', 'campus', 'start_date', 'outstanding_items', 'campus_phone', 'onboarding_link'],
  true, 'family'
),
(
  'first_day_details', 1,
  'Onboarding: first day',
  'Sent a few days before the first day. Carries the practical detail, and asks whether the family needs anything.',
  '{{student_first_name}}''s first day is {{start_date}}',
  'Dear {{parent_first_name}},

{{student_first_name}}''s first day at {{campus}} is {{start_date}}. Please arrive by {{arrival_time}}.

Where to go:
{{campus_address}}

Everything else — what to bring, and the rest of the first fortnight — is here:
{{onboarding_link}}

Is there anything you need help with before {{student_first_name}} starts? Reply to this email, or call us on {{campus_phone}}. We would much rather sort it out now than on the morning.

Warm regards,
Hibiscus International Schools',
  '<p>Dear {{parent_first_name}},</p>'
  || '<p>{{student_first_name}}''s first day at {{campus}} is <strong>{{start_date}}</strong>. Please arrive by <strong>{{arrival_time}}</strong>.</p>'
  || '<p>Where to go:<br>{{campus_address}}</p>'
  || '<p><a href="{{onboarding_link}}">What to bring, and the rest of the first fortnight</a></p>'
  || '<p>Is there anything you need help with before {{student_first_name}} starts? Reply to this email, or call us on {{campus_phone}}. We would much rather sort it out now than on the morning.</p>'
  || '<p>Warm regards,<br>Hibiscus International Schools</p>',
  array['parent_first_name', 'student_first_name', 'campus', 'start_date', 'arrival_time', 'campus_address', 'campus_phone', 'onboarding_link'],
  true, 'family'
),
(
  'first_week_check_in', 1,
  'Onboarding: the first week',
  'Sent a few days after a child starts. Asks for nothing but an answer.',
  'How did {{student_first_name}}''s first week go?',
  'Dear {{parent_first_name}},

{{student_first_name}} has finished their first week at {{campus}}.

The first weeks matter, and we would much rather hear early if something is not right — a friendship, the drop-off, lunch, anything at all.

Just reply to this email and tell us how it went. Someone from the campus will read it and come back to you. You can also call us on {{campus_phone}}.

We are glad they are here.

Warm regards,
Hibiscus International Schools',
  '<p>Dear {{parent_first_name}},</p>'
  || '<p>{{student_first_name}} has finished their first week at {{campus}}.</p>'
  || '<p>The first weeks matter, and we would much rather hear early if something is not right — a friendship, the drop-off, lunch, anything at all.</p>'
  || '<p>Just reply to this email and tell us how it went. Someone from the campus will read it and come back to you. You can also call us on {{campus_phone}}.</p>'
  || '<p>We are glad they are here.</p>'
  || '<p>Warm regards,<br>Hibiscus International Schools</p>',
  array['parent_first_name', 'student_first_name', 'campus', 'campus_phone'],
  true, 'family'
)
on conflict (key, version) do nothing;

-- ---------------------------------------------------------------------------
-- The four WhatsApp companions
-- ---------------------------------------------------------------------------

-- Inactive with no provider id, like every template before approval. Each
-- placeholder is used once — a repeated variable is not something to discover
-- at Meta's approval or, worse, on a parent's phone.
--
-- `first_week_check_in` deliberately has no button. There is nothing for a
-- parent to tap; the whole message is a question, and the answer is a reply.

insert into public.message_templates (key, name, language, body_preview, parameters, button_link, link_purpose, is_active, audience)
values
  (
    'onboarding_welcome',
    'Onboarding: welcome',
    'en',
    E'Hi {{1}}, we are looking forward to welcoming {{2}} to {{3}} on {{4}}. Tap below for everything you need to get ready, and a short guide for new families.',
    array['parent_first_name', 'student_first_name', 'campus', 'start_date'],
    true, 'onboarding', false, 'family'
  ),
  (
    'onboarding_outstanding',
    'Onboarding: still to do',
    'en',
    E'Hi {{1}}, before {{2}} starts at {{3}} on {{4}} we still need: {{5}}. Tap below to finish — it only takes a few minutes.',
    array['parent_first_name', 'student_first_name', 'campus', 'start_date', 'outstanding_items'],
    true, 'onboarding', false, 'family'
  ),
  (
    'first_day_details',
    'Onboarding: first day',
    'en',
    E'Hi {{1}}, {{2}}''s first day at {{3}} is {{4}}. Please arrive by {{5}}. Tap below for where to go and what to bring — and if you need anything before then, just reply to this message.',
    array['parent_first_name', 'student_first_name', 'campus', 'start_date', 'arrival_time'],
    true, 'onboarding', false, 'family'
  ),
  (
    'first_week_check_in',
    'Onboarding: the first week',
    'en',
    E'Hi {{1}}, {{2}} has finished their first week at {{3}}. How did it go? Just reply to this message — someone from the campus will read it and come back to you.',
    array['parent_first_name', 'student_first_name', 'campus'],
    false, 'onboarding', false, 'family'
  )
on conflict (key) do nothing;
