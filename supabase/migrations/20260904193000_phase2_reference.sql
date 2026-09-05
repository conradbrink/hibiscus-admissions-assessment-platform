-- Phase 2 reference data: the confirmed facts about Potch, the competency
-- framework the assessment reports against, the settings the new automation
-- consults, and the emails it sends.
--
-- Two things the school confirmed on 4 September 2026 are recorded here so
-- the "confirm with the school" list in docs/PROJECT-CONTEXT.md can shrink:
-- Potch is in Potchefstroom, South Africa; and the Form 4 age is 15 (the
-- seed already said so; the current website's "14" was a typo).

-- ---------------------------------------------------------------------------
-- Potch
-- ---------------------------------------------------------------------------

-- Country and currency are now facts. The campus stays inactive until staff
-- assign the grades it offers at /staff/admin/grades: an active campus with
-- no grades would appear in the funnel as a door that opens onto nothing.
update public.campuses
   set country = 'ZA',
       currency = 'ZAR',
       descriptor = 'CBD Maury Avenue, Potchefstroom'
 where code = 'potch';

-- ---------------------------------------------------------------------------
-- Capacity
-- ---------------------------------------------------------------------------

-- Places per campus and grade. Null means unlimited. The rules engine counts
-- applications at 'approved' or later for the campus, grade and academic
-- year against this, and waitlists when the count reaches it.
--
-- Deliberately not per academic year: the same number applies every year
-- until somebody changes it, which is how the school actually plans. If that
-- ever stops being true, the count is per year already; only the limit moves.
alter table public.campus_grades
  add column if not exists capacity int check (capacity is null or capacity >= 0);

comment on column public.campus_grades.capacity is
  'Places available for this grade at this campus in an academic year. Null is unlimited.';

-- ---------------------------------------------------------------------------
-- Subjects and competencies
-- ---------------------------------------------------------------------------

-- The framework every question is authored against and every profile reports
-- on. Subjects group competencies; a competency is what a parent reads —
-- "Reading 91%", "Number Sense 72%". Both are rows, not code, because the
-- school will refine them. Whether a competency appears on the parent's
-- profile at all is `reportable`: a diagnostic competency used internally
-- can be scored without being reported.

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists subjects_set_updated_at on public.subjects;
create trigger subjects_set_updated_at
  before update on public.subjects
  for each row execute function public.set_updated_at();

create table if not exists public.competencies (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete restrict,
  code text not null unique,
  name text not null,
  -- Shown to the parent as "Recommended focus" when this competency is an
  -- area for development: "Written expression", not "Written Language".
  focus_label text,
  reportable boolean not null default true,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists competencies_set_updated_at on public.competencies;
create trigger competencies_set_updated_at
  before update on public.competencies
  for each row execute function public.set_updated_at();

create index if not exists competencies_subject_idx on public.competencies(subject_id, sort_order);

alter table public.subjects enable row level security;
alter table public.competencies enable row level security;

-- Readable by every member of staff (the attempt page and the profile tab
-- name them); authored with assessments.author.
drop policy if exists subjects_select on public.subjects;
create policy subjects_select on public.subjects
  for select using ((select public.current_staff_id()) is not null);
drop policy if exists subjects_insert on public.subjects;
create policy subjects_insert on public.subjects
  for insert with check ((select public.has_permission('assessments.author')));
drop policy if exists subjects_update on public.subjects;
create policy subjects_update on public.subjects
  for update using ((select public.has_permission('assessments.author')));
-- No delete: scores reference competencies which reference subjects.

drop policy if exists competencies_select on public.competencies;
create policy competencies_select on public.competencies
  for select using ((select public.current_staff_id()) is not null);
drop policy if exists competencies_insert on public.competencies;
create policy competencies_insert on public.competencies
  for insert with check ((select public.has_permission('assessments.author')));
drop policy if exists competencies_update on public.competencies;
create policy competencies_update on public.competencies
  for update using ((select public.has_permission('assessments.author')));
-- No delete, for the same reason. Deactivate instead.

insert into public.subjects (code, name, sort_order) values
  ('english',     'English',     10),
  ('mathematics', 'Mathematics', 20),
  -- "Reasoning", not "Cognitive". This is an academic assessment and the
  -- parent-facing word must never imply a psychological one.
  ('reasoning',   'Reasoning',   30)
on conflict (code) do nothing;

insert into public.competencies (subject_id, code, name, focus_label, sort_order)
select s.id, c.code, c.name, c.focus_label, c.sort_order
from (values
  ('english',     'reading',             'Reading',             'Reading fluency',        10),
  ('english',     'comprehension',       'Comprehension',       'Reading comprehension',  20),
  ('english',     'vocabulary',          'Vocabulary',          'Vocabulary',             30),
  ('english',     'grammar',             'Grammar',             'Grammar',                40),
  ('english',     'written_language',    'Written Language',    'Written expression',     50),
  ('mathematics', 'number_sense',        'Number Sense',        'Number sense',           10),
  ('mathematics', 'arithmetic',          'Arithmetic',          'Arithmetic',             20),
  ('mathematics', 'problem_solving',     'Problem Solving',     'Mathematical problem solving', 30),
  ('mathematics', 'patterns',            'Patterns',            'Patterns and sequences', 40),
  ('mathematics', 'geometry',            'Geometry',            'Shape and space',        50),
  ('reasoning',   'logical_reasoning',   'Logical Reasoning',   'Logical reasoning',      10),
  ('reasoning',   'pattern_recognition', 'Pattern Recognition', 'Pattern recognition',    20)
) as c(subject_code, code, name, focus_label, sort_order)
join public.subjects s on s.code = c.subject_code
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

-- The booleans here are the "automate it later" switches the design promised:
-- in Phase 2 every email that follows a decision is sent by a person clicking
-- a button. Flipping a switch removes the click; no code changes.
insert into public.settings (key, value, description) values
  ('kiosk_code_minutes',        '15',    'Minutes a launch code for the assessment computer stays valid.'),
  ('attempt_grace_seconds',     '30',    'Seconds after the assessment timer ends during which a late answer or submission is still accepted.'),
  ('auto_send_outcomes',        'false', 'Send waitlist and decline emails automatically. When off, staff click Send on the Outcomes tab.'),
  ('offer_auto_approve',        'false', 'Send offers without a person approving them first. When off, offers wait in the approval queue.'),
  ('profile_shared_on_decline', 'true',  'Whether a declined applicant''s parent receives the learning profile.'),
  ('ai_narrative_enabled',      'true',  'Use the AI provider to write the learning profile narrative. When off, the deterministic wording is used.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Email templates
-- ---------------------------------------------------------------------------
--
-- Inserted here rather than through the editor because publish_email_template
-- refuses an unknown key and carries allowed_variables forward: the set of
-- variables a template may use is decided in migrations, the wording is not.
-- Every one of these is expected to be rewritten by the school.

insert into public.email_templates (key, name, description, subject, body_text, body_html, allowed_variables)
values
(
  'assessment_completed',
  'Assessment completed',
  'Sent when the child submits the assessment. Sets expectations about the results email.',
  '{{student_first_name}} has completed the assessment',
  E'Dear {{parent_first_name}},\n\n{{student_first_name}} has completed the assessment today — well done to them.\n\nThere is nothing you need to do now. We are preparing {{student_first_name}}''s learning profile, and you will receive it by email together with the outcome of the application.\n\nReference: {{application_reference}}\n\nHibiscus Schools Admissions',
  '<p>Dear {{parent_first_name}},</p><p><strong>{{student_first_name}} has completed the assessment today</strong> — well done to them.</p><p>There is nothing you need to do now. We are preparing {{student_first_name}}''s learning profile, and you will receive it by email together with the outcome of the application.</p><p>Reference: {{application_reference}}</p><p>Hibiscus Schools Admissions</p>',
  array['parent_first_name','student_first_name','campus','grade','application_reference','next_step_link']
),
(
  'results_and_offer',
  'Assessment results and offer of admission',
  'Sent when an offer is approved. Carries the learning profile link and the offer link.',
  '{{student_first_name}} — assessment results and Hibiscus admission offer',
  E'Dear {{parent_first_name}},\n\nThank you for bringing {{student_first_name}} to be assessed.\n\n{{student_first_name}}''s learning profile is now ready. It summarises strengths and areas to develop, and it is yours to keep:\n{{results_link}}\n\nWe are also delighted to offer {{student_first_name}} a place at {{campus}} in {{grade}}.\n\nPlease view the offer here:\n{{offer_link}}\n\nThe offer is open until {{offer_expiry_date}}.{{#if amount_due}} The registration and admission fees payable on acceptance are {{amount_due}}.{{/if}}\n\nReference: {{application_reference}}\n\nWarm regards,\nHibiscus Schools Admissions',
  '<p>Dear {{parent_first_name}},</p><p>Thank you for bringing {{student_first_name}} to be assessed.</p><p>{{student_first_name}}''s learning profile is now ready. It summarises strengths and areas to develop, and it is yours to keep.</p><p><a href="{{results_link}}" class="button">View learning profile</a></p><p>We are also delighted to offer <strong>{{student_first_name}}</strong> a place at <strong>{{campus}}</strong> in <strong>{{grade}}</strong>.</p><p><a href="{{offer_link}}" class="button">View the offer</a></p><p>The offer is open until <strong>{{offer_expiry_date}}</strong>.{{#if amount_due}} The registration and admission fees payable on acceptance are {{amount_due}}.{{/if}}</p><p>Reference: {{application_reference}}</p><p>Warm regards,<br>Hibiscus Schools Admissions</p>',
  array['parent_first_name','student_first_name','campus','grade','application_reference','results_link','offer_link','offer_expiry_date','amount_due','next_step_link']
),
(
  'outcome_waitlisted',
  'Outcome — waitlisted',
  'Sent, after a person confirms it, when a child meets the criteria but no place is available.',
  '{{student_first_name}} — assessment results and waiting list',
  E'Dear {{parent_first_name}},\n\nThank you for bringing {{student_first_name}} to be assessed. {{student_first_name}}''s learning profile is ready and is yours to keep:\n{{results_link}}\n\n{{student_first_name}} met our admission criteria. At the moment, however, {{grade}} at {{campus}} is full, and we have placed {{student_first_name}} on the waiting list. We will contact you as soon as a place becomes available.\n\nReference: {{application_reference}}\n\nWarm regards,\nHibiscus Schools Admissions',
  '<p>Dear {{parent_first_name}},</p><p>Thank you for bringing {{student_first_name}} to be assessed. {{student_first_name}}''s learning profile is ready and is yours to keep.</p><p><a href="{{results_link}}" class="button">View learning profile</a></p><p>{{student_first_name}} met our admission criteria. At the moment, however, <strong>{{grade}}</strong> at <strong>{{campus}}</strong> is full, and we have placed {{student_first_name}} on the waiting list. We will contact you as soon as a place becomes available.</p><p>Reference: {{application_reference}}</p><p>Warm regards,<br>Hibiscus Schools Admissions</p>',
  array['parent_first_name','student_first_name','campus','grade','application_reference','results_link','next_step_link']
),
(
  'outcome_declined',
  'Outcome — not offered a place',
  'Sent, after a person confirms it, when the school cannot offer a place. Links the learning profile when the school shares it.',
  '{{student_first_name}} — assessment results',
  E'Dear {{parent_first_name}},\n\nThank you for bringing {{student_first_name}} to be assessed, and for your interest in Hibiscus Schools.\n\nAfter careful consideration we are unable to offer {{student_first_name}} a place in {{grade}} at {{campus}} at this time.\n\n{{#if results_link}}{{student_first_name}}''s learning profile is ready. It summarises strengths and areas to develop, and we hope it is useful whatever you decide next:\n{{results_link}}\n\n{{/if}}If you would like to discuss the assessment, please reply to this email and a member of our admissions team will be in touch.\n\nReference: {{application_reference}}\n\nWith best wishes,\nHibiscus Schools Admissions',
  '<p>Dear {{parent_first_name}},</p><p>Thank you for bringing {{student_first_name}} to be assessed, and for your interest in Hibiscus Schools.</p><p>After careful consideration we are unable to offer {{student_first_name}} a place in {{grade}} at {{campus}} at this time.</p>{{#if results_link}}<p>{{student_first_name}}''s learning profile is ready. It summarises strengths and areas to develop, and we hope it is useful whatever you decide next.</p><p><a href="{{results_link}}" class="button">View learning profile</a></p>{{/if}}<p>If you would like to discuss the assessment, please reply to this email and a member of our admissions team will be in touch.</p><p>Reference: {{application_reference}}</p><p>With best wishes,<br>Hibiscus Schools Admissions</p>',
  array['parent_first_name','student_first_name','campus','grade','application_reference','results_link','next_step_link']
),
(
  'offer_reminder',
  'Offer reminder',
  'Sent before the offer expires, only while the offer is still open.',
  'Reminder: {{student_first_name}}''s offer is open until {{offer_expiry_date}}',
  E'Dear {{parent_first_name}},\n\nA reminder that {{student_first_name}}''s offer of a place at {{campus}} in {{grade}} is open until {{offer_expiry_date}}.\n\nYou can view the offer here:\n{{offer_link}}\n\nIf you have any questions, simply reply to this email.\n\nHibiscus Schools Admissions',
  '<p>Dear {{parent_first_name}},</p><p>A reminder that {{student_first_name}}''s offer of a place at <strong>{{campus}}</strong> in <strong>{{grade}}</strong> is open until <strong>{{offer_expiry_date}}</strong>.</p><p><a href="{{offer_link}}" class="button">View the offer</a></p><p>If you have any questions, simply reply to this email.</p><p>Hibiscus Schools Admissions</p>',
  array['parent_first_name','student_first_name','campus','grade','offer_link','offer_expiry_date','application_reference','next_step_link']
),
(
  'offer_expired',
  'Offer expired',
  'Sent when an offer reaches its expiry date without being accepted.',
  '{{student_first_name}}''s offer has expired',
  E'Dear {{parent_first_name}},\n\nThe offer of a place for {{student_first_name}} at {{campus}} in {{grade}} expired on {{offer_expiry_date}}.\n\nIf you would still like to take up the place, please reply to this email or call the admissions office and we will do what we can.\n\nReference: {{application_reference}}\n\nHibiscus Schools Admissions',
  '<p>Dear {{parent_first_name}},</p><p>The offer of a place for {{student_first_name}} at <strong>{{campus}}</strong> in <strong>{{grade}}</strong> expired on {{offer_expiry_date}}.</p><p>If you would still like to take up the place, please reply to this email or call the admissions office and we will do what we can.</p><p>Reference: {{application_reference}}</p><p>Hibiscus Schools Admissions</p>',
  array['parent_first_name','student_first_name','campus','grade','offer_expiry_date','application_reference','next_step_link']
)
on conflict (key, version) do nothing;
