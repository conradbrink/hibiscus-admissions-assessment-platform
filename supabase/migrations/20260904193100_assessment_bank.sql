-- The question bank: what a child is asked, and what the right answer is.
--
-- Two design rules run through this file.
--
-- First, the answer key lives in its own table, `question_answers`, with its
-- own policy, and only a member of staff holding assessments.author may read
-- it. The kiosk that delivers an assessment never joins it — see
-- web/AGENTS.md, "Answers never leave the server". Splitting the table is what
-- makes that rule enforceable by the database rather than by code review.
--
-- Second, nothing here is what a child actually sat. When an assessment is
-- launched, the questions drawn are copied into `form_questions` and their
-- keys into `form_answer_keys` (next migration). Editing a question or its
-- key afterwards changes future sittings and never a past result.

-- ---------------------------------------------------------------------------
-- Banks, passages, rubrics
-- ---------------------------------------------------------------------------

create table if not exists public.question_banks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  -- The dev seed's bank. Never used by a real template; shown with a warning.
  is_sample boolean not null default false,
  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists question_banks_set_updated_at on public.question_banks;
create trigger question_banks_set_updated_at
  before update on public.question_banks
  for each row execute function public.set_updated_at();

-- A reading stimulus shared by several questions. Snapshotted into each form
-- question that uses it, so a later edit cannot change what a child read.
create table if not exists public.passages (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.question_banks(id) on delete cascade,
  title text not null,
  body text not null,
  media_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists passages_set_updated_at on public.passages;
create trigger passages_set_updated_at
  before update on public.passages
  for each row execute function public.set_updated_at();

create index if not exists passages_bank_idx on public.passages(bank_id);

-- How a piece of extended writing is marked. Bands are ordered by
-- min_marks; the assessor picks one and the band's marks are awarded. An AI
-- may *suggest* a band from the same descriptors; it never awards one.
create table if not exists public.rubrics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  competency_id uuid not null references public.competencies(id) on delete restrict,
  max_marks numeric(5,2) not null check (max_marks > 0),
  -- [{ key, label, min_marks, descriptor }], validated in the editor.
  bands jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists rubrics_set_updated_at on public.rubrics;
create trigger rubrics_set_updated_at
  before update on public.rubrics
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Questions
-- ---------------------------------------------------------------------------

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.question_banks(id) on delete cascade,
  competency_id uuid not null references public.competencies(id) on delete restrict,
  passage_id uuid references public.passages(id) on delete set null,
  type text not null check (type in (
    'single_choice', 'multi_select', 'numeric', 'short_text', 'matching', 'ordering', 'extended_text'
  )),
  stem text not null,
  stem_media_path text,
  marks numeric(5,2) not null default 1 check (marks > 0),
  difficulty int not null default 3 check (difficulty between 1 and 5),
  -- The band of grades this question suits, on grades.sort_order — the same
  -- scale sessions use. Null on both means any grade.
  grade_sort_min int,
  grade_sort_max int,
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  -- Bumped by trigger whenever the content changes, so a form can record
  -- which wording a child saw.
  version int not null default 1,
  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (grade_sort_min is null or grade_sort_max is null or grade_sort_max >= grade_sort_min)
);

drop trigger if exists questions_set_updated_at on public.questions;
create trigger questions_set_updated_at
  before update on public.questions
  for each row execute function public.set_updated_at();

create or replace function public.questions_bump_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.stem is distinct from old.stem
     or new.stem_media_path is distinct from old.stem_media_path
     or new.type is distinct from old.type
     or new.marks is distinct from old.marks
     or new.passage_id is distinct from old.passage_id then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

revoke all on function public.questions_bump_version() from public, anon, authenticated;

drop trigger if exists questions_bump_version on public.questions;
create trigger questions_bump_version
  before update on public.questions
  for each row execute function public.questions_bump_version();

create index if not exists questions_bank_idx on public.questions(bank_id, status);
create index if not exists questions_competency_idx on public.questions(competency_id);
-- The draw a random section makes: active questions of a competency at a
-- difficulty within a grade band.
create index if not exists questions_draw_idx
  on public.questions(competency_id, difficulty)
  where status = 'active';

-- Options for choice, matching and ordering questions. For matching, `side`
-- says which column the option is in; for everything else it is null.
create table if not exists public.question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  position int not null check (position >= 1),
  label text not null,
  media_path text,
  side text check (side is null or side in ('left', 'right')),
  unique nulls not distinct (question_id, side, position)
);

create index if not exists question_options_question_idx on public.question_options(question_id);

-- The key. One row per question; absent for a draft that has no key yet.
--
--   single_choice   { "option_ids": [id] }
--   multi_select    { "option_ids": [id, …] }
--   numeric         { "value": 12.5, "tolerance": 0 }
--   short_text      { "accepted": ["twelve", "12"] }
--   matching        { "pairs": [[left_id, right_id], …] }
--   ordering        { "order": [id, …] }
--   extended_text   answer null; rubric_id required
--
-- Shapes are validated in the editor (Zod) and re-validated by the marker,
-- which treats a malformed key as "cannot mark" rather than "wrong".
create table if not exists public.question_answers (
  question_id uuid primary key references public.questions(id) on delete cascade,
  answer jsonb,
  -- multi_select, matching, ordering: award marks per correct part rather
  -- than all-or-nothing.
  partial_credit boolean not null default false,
  rubric_id uuid references public.rubrics(id) on delete restrict,
  updated_at timestamptz not null default now()
);

drop trigger if exists question_answers_set_updated_at on public.question_answers;
create trigger question_answers_set_updated_at
  before update on public.question_answers
  for each row execute function public.set_updated_at();

-- A key must match its question's kind: writing needs a rubric and no
-- answer, everything else needs an answer. Checked here because the two
-- tables are edited separately and a mismatch would surface as an unmarkable
-- response on assessment day.
create or replace function public.question_answers_check_kind()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type text;
begin
  select type into v_type from public.questions where id = new.question_id;
  if v_type = 'extended_text' then
    if new.rubric_id is null then
      raise exception 'A written-response question needs a rubric.';
    end if;
  elsif new.answer is null then
    raise exception 'This question type needs an answer key.';
  end if;
  return new;
end;
$$;

revoke all on function public.question_answers_check_kind() from public, anon, authenticated;

drop trigger if exists question_answers_check_kind on public.question_answers;
create trigger question_answers_check_kind
  before insert or update on public.question_answers
  for each row execute function public.question_answers_check_kind();

-- ---------------------------------------------------------------------------
-- Templates: what a sitting is made of
-- ---------------------------------------------------------------------------

-- A template is resolved at launch: the active one whose grade band contains
-- the applicant's grade, preferring one pinned to the campus over a global
-- one. Sections run in order; each draws its questions either as a fixed
-- list or at random from the bank by competency and difficulty.
create table if not exists public.assessment_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  grade_sort_min int not null,
  grade_sort_max int not null,
  campus_id uuid references public.campuses(id) on delete cascade,
  time_limit_minutes int not null check (time_limit_minutes > 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  version int not null default 1,
  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (grade_sort_max >= grade_sort_min)
);

drop trigger if exists assessment_templates_set_updated_at on public.assessment_templates;
create trigger assessment_templates_set_updated_at
  before update on public.assessment_templates
  for each row execute function public.set_updated_at();

create index if not exists assessment_templates_active_idx
  on public.assessment_templates(grade_sort_min, grade_sort_max)
  where status = 'active';

create table if not exists public.template_sections (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.assessment_templates(id) on delete cascade,
  position int not null check (position >= 1),
  title text not null,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  instructions text,
  -- Null: the section has no timer of its own; the template's applies.
  time_limit_minutes int check (time_limit_minutes is null or time_limit_minutes > 0),
  selection text not null default 'fixed' check (selection in ('fixed', 'random')),
  -- For random sections: how many to draw, and optionally how many at each
  -- difficulty, e.g. {"2": 3, "3": 4, "4": 3}. Draws come from active
  -- questions in the same bank(s) as the fixed questions, or any active bank
  -- when the section has none — by competency within the subject.
  random_count int check (random_count is null or random_count > 0),
  random_difficulty_mix jsonb,
  -- A question shown before the section starts, never marked. Lets the
  -- youngest children try the interaction once.
  practice_question_id uuid references public.questions(id) on delete set null,
  unique (template_id, position)
);

create index if not exists template_sections_template_idx on public.template_sections(template_id, position);

create table if not exists public.template_section_questions (
  section_id uuid not null references public.template_sections(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  position int not null check (position >= 1),
  primary key (section_id, question_id),
  unique (section_id, position)
);

-- ---------------------------------------------------------------------------
-- Benchmarks: how a percentage becomes a word
-- ---------------------------------------------------------------------------

-- Bands turn "64%" into "approaching" on the learning profile. They are
-- presentation, not admission criteria: the rules engine reads thresholds
-- from admission_rulesets, never from here. `scope_id` is polymorphic — a
-- subject or competency id, with no foreign key because it can point at
-- either — and null for `overall`. The most specific active row wins: a
-- competency row over a subject row over an overall row, and a grade-banded
-- row over an unbanded one.
create table if not exists public.benchmarks (
  id uuid primary key default gen_random_uuid(),
  grade_sort_min int,
  grade_sort_max int,
  scope text not null check (scope in ('overall', 'subject', 'competency')),
  scope_id uuid,
  -- [{ "key": "below", "min_percent": 0 }, { "key": "approaching", "min_percent": 40 }, …]
  bands jsonb not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope = 'overall') = (scope_id is null)),
  check (grade_sort_min is null or grade_sort_max is null or grade_sort_max >= grade_sort_min)
);

drop trigger if exists benchmarks_set_updated_at on public.benchmarks;
create trigger benchmarks_set_updated_at
  before update on public.benchmarks
  for each row execute function public.set_updated_at();

-- ⚠️ Placeholder bands, labelled as such. The school's education staff set
-- the real ones at /staff/admin/benchmarks. Nothing about admission depends
-- on these numbers.
insert into public.benchmarks (scope, scope_id, bands, description)
select 'overall', null,
  '[{"key":"below","min_percent":0},{"key":"approaching","min_percent":40},{"key":"meeting","min_percent":60},{"key":"exceeding","min_percent":80}]'::jsonb,
  'PLACEHOLDER — default bands for every scope and grade until the school sets its own.'
where not exists (select 1 from public.benchmarks);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.question_banks enable row level security;
alter table public.passages enable row level security;
alter table public.rubrics enable row level security;
alter table public.questions enable row level security;
alter table public.question_options enable row level security;
alter table public.question_answers enable row level security;
alter table public.assessment_templates enable row level security;
alter table public.template_sections enable row level security;
alter table public.template_section_questions enable row level security;
alter table public.benchmarks enable row level security;

-- Everything except the key: readable by any member of staff (the attempt
-- page shows stems, the profile tab shows rubric descriptors), written by
-- authors. Deletes are allowed for authors only while the row is a draft, so
-- a question that has been offered to a child can only be retired.

drop policy if exists question_banks_select on public.question_banks;
create policy question_banks_select on public.question_banks
  for select using ((select public.current_staff_id()) is not null);
drop policy if exists question_banks_insert on public.question_banks;
create policy question_banks_insert on public.question_banks
  for insert with check (
    (select public.has_permission('assessments.author'))
    and created_by = (select auth.uid())
  );
drop policy if exists question_banks_update on public.question_banks;
create policy question_banks_update on public.question_banks
  for update using ((select public.has_permission('assessments.author')));
drop policy if exists question_banks_delete on public.question_banks;
create policy question_banks_delete on public.question_banks
  for delete using ((select public.has_permission('assessments.author')) and status = 'draft');

drop policy if exists passages_select on public.passages;
create policy passages_select on public.passages
  for select using ((select public.current_staff_id()) is not null);
drop policy if exists passages_insert on public.passages;
create policy passages_insert on public.passages
  for insert with check ((select public.has_permission('assessments.author')));
drop policy if exists passages_update on public.passages;
create policy passages_update on public.passages
  for update using ((select public.has_permission('assessments.author')));
drop policy if exists passages_delete on public.passages;
create policy passages_delete on public.passages
  for delete using ((select public.has_permission('assessments.author')));

drop policy if exists rubrics_select on public.rubrics;
create policy rubrics_select on public.rubrics
  for select using ((select public.current_staff_id()) is not null);
drop policy if exists rubrics_insert on public.rubrics;
create policy rubrics_insert on public.rubrics
  for insert with check ((select public.has_permission('assessments.author')));
drop policy if exists rubrics_update on public.rubrics;
create policy rubrics_update on public.rubrics
  for update using ((select public.has_permission('assessments.author')));
-- No delete: keys and form snapshots reference rubrics.

drop policy if exists questions_select on public.questions;
create policy questions_select on public.questions
  for select using ((select public.current_staff_id()) is not null);
drop policy if exists questions_insert on public.questions;
create policy questions_insert on public.questions
  for insert with check (
    (select public.has_permission('assessments.author'))
    and created_by = (select auth.uid())
  );
drop policy if exists questions_update on public.questions;
create policy questions_update on public.questions
  for update using ((select public.has_permission('assessments.author')));
drop policy if exists questions_delete on public.questions;
create policy questions_delete on public.questions
  for delete using ((select public.has_permission('assessments.author')) and status = 'draft');

drop policy if exists question_options_select on public.question_options;
create policy question_options_select on public.question_options
  for select using ((select public.current_staff_id()) is not null);
drop policy if exists question_options_write on public.question_options;
create policy question_options_write on public.question_options
  for all using ((select public.has_permission('assessments.author')))
  with check ((select public.has_permission('assessments.author')));

-- ⚠️ The key. Authors only, for every verb. There is no "any staff" select
-- here on purpose, and there must never be one: an assessor sees the child's
-- answers and the marks the server awarded, never the key.
drop policy if exists question_answers_author on public.question_answers;
create policy question_answers_author on public.question_answers
  for all using ((select public.has_permission('assessments.author')))
  with check ((select public.has_permission('assessments.author')));

drop policy if exists assessment_templates_select on public.assessment_templates;
create policy assessment_templates_select on public.assessment_templates
  for select using ((select public.current_staff_id()) is not null);
drop policy if exists assessment_templates_insert on public.assessment_templates;
create policy assessment_templates_insert on public.assessment_templates
  for insert with check (
    (select public.has_permission('assessments.author'))
    and created_by = (select auth.uid())
  );
drop policy if exists assessment_templates_update on public.assessment_templates;
create policy assessment_templates_update on public.assessment_templates
  for update using ((select public.has_permission('assessments.author')));
drop policy if exists assessment_templates_delete on public.assessment_templates;
create policy assessment_templates_delete on public.assessment_templates
  for delete using ((select public.has_permission('assessments.author')) and status = 'draft');

drop policy if exists template_sections_select on public.template_sections;
create policy template_sections_select on public.template_sections
  for select using ((select public.current_staff_id()) is not null);
drop policy if exists template_sections_write on public.template_sections;
create policy template_sections_write on public.template_sections
  for all using ((select public.has_permission('assessments.author')))
  with check ((select public.has_permission('assessments.author')));

drop policy if exists template_section_questions_select on public.template_section_questions;
create policy template_section_questions_select on public.template_section_questions
  for select using ((select public.current_staff_id()) is not null);
drop policy if exists template_section_questions_write on public.template_section_questions;
create policy template_section_questions_write on public.template_section_questions
  for all using ((select public.has_permission('assessments.author')))
  with check ((select public.has_permission('assessments.author')));

drop policy if exists benchmarks_select on public.benchmarks;
create policy benchmarks_select on public.benchmarks
  for select using ((select public.current_staff_id()) is not null);
drop policy if exists benchmarks_write on public.benchmarks;
create policy benchmarks_write on public.benchmarks
  for all using ((select public.has_permission('assessments.author')))
  with check ((select public.has_permission('assessments.author')));
