-- ===========================================================================
-- HR recruitment: vacancies, applications, interview questions, answers,
-- references, scores and interviews.
--
-- Applicants and referees are never database principals. They reach the HR
-- app through a magic link exchanged for a signed cookie, and every read and
-- write on their behalf runs under the service role, scoped in code by the id
-- in that cookie (hr/lib/applicant/scope.ts). So the policies below are for
-- staff only, and they are read policies: staff changes to an application go
-- through the HR app's server actions, which check the permission, read the
-- row through these policies (so a campus restriction answers "not found"),
-- and then write under the service role with an audit row. There is no staff
-- write policy on these tables, on purpose.
-- ===========================================================================

-- Trigram similarity, for the duplicate-answer check. In the `extensions`
-- schema as Supabase expects, and on this migration's search path so the
-- index below can name the operator class unqualified.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Vacancies
-- ---------------------------------------------------------------------------

create table if not exists public.hr_vacancies (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid not null references public.campuses(id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null,
  phase text not null check (phase in ('preschool', 'primary', 'secondary', 'general')),
  subject text,
  grade_range text,
  employment_type text not null default 'permanent'
    check (employment_type in ('permanent', 'fixed_term', 'part_time', 'temporary')),
  summary text not null default '',
  description text not null default '',
  requirements text[] not null default '{}'::text[],
  salary_note text,
  starts_on date,
  closes_on date,
  status text not null default 'draft' check (status in ('draft', 'published', 'closed', 'archived')),
  -- Copied from hr_settings when the vacancy is published, so changing the
  -- weights later does not re-rank applicants who were scored under the old
  -- ones.
  scoring_weights jsonb,
  published_at timestamptz,
  published_by uuid references public.staff_profiles(id) on delete set null,
  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hr_vacancies_status_idx on public.hr_vacancies (status, closes_on);
create index if not exists hr_vacancies_campus_idx on public.hr_vacancies (campus_id);

drop trigger if exists hr_vacancies_set_updated_at on public.hr_vacancies;
create trigger hr_vacancies_set_updated_at
  before update on public.hr_vacancies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Applications
-- ---------------------------------------------------------------------------

create sequence if not exists public.hr_application_ref_seq;

create table if not exists public.hr_applications (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  vacancy_id uuid not null references public.hr_vacancies(id) on delete restrict,
  -- Copied from the vacancy so the campus filter on every policy is one
  -- column, not a join.
  campus_id uuid not null references public.campuses(id) on delete restrict,
  email text not null,
  email_normalised text not null,
  first_name text not null,
  last_name text not null,
  phone text,
  nationality text,
  is_citizen boolean,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'withdrawn', 'hired', 'anonymised')),
  -- The pipeline: exactly three categories, null while the form is a draft.
  stage text check (stage in ('review', 'shortlisted', 'unsuccessful')),
  stage_reason text,
  stage_changed_at timestamptz,
  stage_changed_by uuid references public.staff_profiles(id) on delete set null,
  sections_completed text[] not null default '{}'::text[],
  privacy_notice_version text not null,
  consented_at timestamptz not null,
  talent_pool_consent boolean not null default false,
  integrity_notice_accepted_at timestamptz,
  submitted_at timestamptz,
  last_saved_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  retention_due_at timestamptz,
  anonymised_at timestamptz,
  -- Communication is marked over all the answers together, so it lives here
  -- rather than on an answer.
  communication_ai_band smallint check (communication_ai_band between 0 and 4),
  communication_ai_rationale text,
  communication_human_band smallint check (communication_human_band between 0 and 4),
  -- The latest score, copied from hr_application_scores for the board.
  score_total numeric(5,2),
  score_available int,
  score_flags text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_applications_stage_needs_submission check (
    (status = 'draft' and stage is null) or status <> 'draft'
  )
);

create index if not exists hr_applications_vacancy_stage_idx on public.hr_applications (vacancy_id, stage);
create index if not exists hr_applications_campus_idx on public.hr_applications (campus_id, status);
create index if not exists hr_applications_email_idx on public.hr_applications (email_normalised);
create unique index if not exists hr_applications_one_live_per_vacancy_idx
  on public.hr_applications (vacancy_id, email_normalised)
  where status in ('draft', 'submitted');
create index if not exists hr_applications_retention_idx on public.hr_applications (retention_due_at)
  where retention_due_at is not null and status <> 'anonymised';

drop trigger if exists hr_applications_set_updated_at on public.hr_applications;
create trigger hr_applications_set_updated_at
  before update on public.hr_applications
  for each row execute function public.set_updated_at();

create or replace function public.hr_applications_set_reference()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.reference is null or new.reference = '' then
    new.reference := 'HR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.hr_application_ref_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

revoke all on function public.hr_applications_set_reference() from public, anon, authenticated;

drop trigger if exists hr_applications_reference on public.hr_applications;
create trigger hr_applications_reference
  before insert on public.hr_applications
  for each row execute function public.hr_applications_set_reference();

-- The timeline: everything that happened to an application, in order.
create table if not exists public.hr_application_events (
  id bigint generated always as identity primary key,
  application_id uuid not null references public.hr_applications(id) on delete cascade,
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  actor_type text not null check (actor_type in ('staff', 'applicant', 'referee', 'system')),
  actor_id uuid,
  occurred_at timestamptz not null default now()
);

create index if not exists hr_application_events_app_idx on public.hr_application_events (application_id, id desc);

create table if not exists public.hr_application_notes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.hr_applications(id) on delete cascade,
  author_id uuid references public.staff_profiles(id) on delete set null,
  body text not null check (length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);

create index if not exists hr_application_notes_app_idx on public.hr_application_notes (application_id, created_at desc);

create table if not exists public.hr_application_qualifications (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.hr_applications(id) on delete cascade,
  level text not null check (level in (
    'certificate', 'diploma', 'degree', 'honours', 'postgraduate_certificate', 'masters', 'doctorate', 'other'
  )),
  title text not null,
  institution text not null,
  year_completed int check (year_completed between 1950 and 2100),
  country text,
  -- A teaching qualification (B.Ed, PGCE, ECD diploma), as the applicant
  -- describes it. Staff can see the title and judge.
  is_teaching boolean not null default false,
  sort_order int not null default 0
);

create index if not exists hr_application_qualifications_app_idx on public.hr_application_qualifications (application_id);

create table if not exists public.hr_application_employment (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.hr_applications(id) on delete cascade,
  employer text not null,
  role_title text not null,
  is_school boolean not null default true,
  phase_taught text,
  start_on date not null,
  -- Null while the job is current.
  end_on date,
  reason_for_leaving text,
  sort_order int not null default 0,
  constraint hr_application_employment_dates check (end_on is null or end_on >= start_on)
);

create index if not exists hr_application_employment_app_idx on public.hr_application_employment (application_id);

-- Compliance: who may teach, and the safeguarding declarations. Read only by
-- people who hold the compliance permission.
create table if not exists public.hr_application_compliance (
  application_id uuid primary key references public.hr_applications(id) on delete cascade,
  -- SACE in South Africa, the Botswana Teaching Professionals Council in
  -- Botswana.
  registration_body text check (registration_body in ('SACE', 'BTPC', 'other', 'none')),
  registration_number text,
  registration_expires_on date,
  needs_permit boolean,
  permit_type text,
  permit_number text,
  permit_expires_on date,
  police_clearance text check (police_clearance in ('have', 'applied', 'none')),
  police_clearance_issued_on date,
  -- South Africa: the National Register for Sex Offenders and Part B of the
  -- Child Protection Register. Botswana staff answer the same question about
  -- any equivalent record.
  child_protection_clear boolean,
  criminal_record boolean,
  criminal_record_detail text,
  dismissed_before boolean,
  dismissed_detail text,
  safeguarding_concern boolean,
  safeguarding_detail text,
  declaration_name text,
  declared_at timestamptz,
  updated_at timestamptz not null default now()
);

drop trigger if exists hr_application_compliance_set_updated_at on public.hr_application_compliance;
create trigger hr_application_compliance_set_updated_at
  before update on public.hr_application_compliance
  for each row execute function public.set_updated_at();

create table if not exists public.hr_application_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.hr_applications(id) on delete cascade,
  kind text not null check (kind in ('cv', 'certificate', 'registration', 'permit', 'police_clearance', 'id', 'other')),
  file_name text not null,
  storage_path text not null unique,
  mime text not null check (mime in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text not null,
  scan_status text not null default 'not_scanned' check (scan_status in ('not_scanned', 'clean', 'infected', 'error')),
  uploaded_at timestamptz not null default now()
);

create index if not exists hr_application_documents_app_idx on public.hr_application_documents (application_id);

-- ---------------------------------------------------------------------------
-- Interview questions
-- ---------------------------------------------------------------------------

-- The banks, one per phase, seeded from hr/content/question-banks.
create table if not exists public.hr_question_banks (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  phase text not null check (phase in ('preschool', 'primary', 'secondary', 'general')),
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists hr_question_banks_set_updated_at on public.hr_question_banks;
create trigger hr_question_banks_set_updated_at
  before update on public.hr_question_banks
  for each row execute function public.set_updated_at();

create table if not exists public.hr_bank_questions (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.hr_question_banks(id) on delete cascade,
  code text not null unique,
  -- Core questions go to every vacancy in the phase; the pool is what the AI
  -- chooses from and tailors.
  kind text not null check (kind in ('core', 'pool')),
  competency text not null check (competency in (
    'safeguarding', 'pedagogy', 'classroom_management', 'inclusion', 'communication',
    'professionalism', 'subject_knowledge', 'early_years_practice', 'assessment', 'teamwork'
  )),
  prompt text not null,
  guidance text,
  -- {"bands": [{"band": 0, "descriptor": "…"}, … {"band": 4, …}]}
  rubric jsonb not null,
  word_limit int not null default 250 check (word_limit between 50 and 800),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hr_bank_questions_bank_idx on public.hr_bank_questions (bank_id, sort_order);

drop trigger if exists hr_bank_questions_set_updated_at on public.hr_bank_questions;
create trigger hr_bank_questions_set_updated_at
  before update on public.hr_bank_questions
  for each row execute function public.set_updated_at();

-- What one vacancy asks. Drafted from the bank (by the AI or by hand),
-- approved by a person, and frozen once the vacancy is published.
create table if not exists public.hr_vacancy_questions (
  id uuid primary key default gen_random_uuid(),
  vacancy_id uuid not null references public.hr_vacancies(id) on delete cascade,
  source_bank_question_id uuid references public.hr_bank_questions(id) on delete set null,
  prompt text not null,
  competency text not null,
  rubric jsonb not null,
  word_limit int not null default 250 check (word_limit between 50 and 800),
  origin text not null check (origin in ('bank', 'ai', 'manual')),
  ai_rationale text,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  approved_by uuid references public.staff_profiles(id) on delete set null,
  approved_at timestamptz,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists hr_vacancy_questions_vacancy_idx on public.hr_vacancy_questions (vacancy_id, sort_order);

-- Once applicants can answer, the questions and rubrics they answered must
-- stay exactly as they were: a mark is only meaningful against the rubric it
-- was given under.
create or replace function public.hr_vacancy_questions_frozen()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  select status into v_status from public.hr_vacancies
   where id = coalesce(new.vacancy_id, old.vacancy_id);
  if v_status is distinct from 'draft' then
    raise exception 'vacancy_questions_frozen' using hint = 'Questions cannot change once the vacancy is published.';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.hr_vacancy_questions_frozen() from public, anon, authenticated;

drop trigger if exists hr_vacancy_questions_frozen on public.hr_vacancy_questions;
create trigger hr_vacancy_questions_frozen
  before insert or update or delete on public.hr_vacancy_questions
  for each row execute function public.hr_vacancy_questions_frozen();

create table if not exists public.hr_application_answers (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.hr_applications(id) on delete cascade,
  vacancy_question_id uuid not null references public.hr_vacancy_questions(id) on delete restrict,
  answer_text text not null default '',
  word_count int not null default 0,
  -- How the answer was written, recorded in the browser: active typing time,
  -- keystrokes, characters pasted, paste events, times the tab lost focus.
  -- Read only by staff; never shown back to the applicant.
  integrity jsonb not null default '{}'::jsonb,
  ai_band smallint check (ai_band between 0 and 4),
  ai_rationale text,
  ai_evidence jsonb,
  ai_model text,
  ai_marked_at timestamptz,
  human_band smallint check (human_band between 0 and 4),
  human_note text,
  marked_by uuid references public.staff_profiles(id) on delete set null,
  marked_at timestamptz,
  -- The AI-writing check. A flag for a person, never a mark.
  ai_likelihood text check (ai_likelihood in ('low', 'medium', 'high')),
  ai_likelihood_reasons jsonb,
  ai_checked_at timestamptz,
  duplicate_of_answer_id uuid references public.hr_application_answers(id) on delete set null,
  duplicate_similarity numeric(4,3),
  updated_at timestamptz not null default now(),
  unique (application_id, vacancy_question_id)
);

create index if not exists hr_application_answers_question_idx on public.hr_application_answers (vacancy_question_id);
create index if not exists hr_application_answers_trgm_idx
  on public.hr_application_answers using gin (answer_text gin_trgm_ops);

drop trigger if exists hr_application_answers_set_updated_at on public.hr_application_answers;
create trigger hr_application_answers_set_updated_at
  before update on public.hr_application_answers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- References
-- ---------------------------------------------------------------------------

create table if not exists public.hr_referees (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.hr_applications(id) on delete cascade,
  full_name text not null,
  relationship text not null check (relationship in ('principal', 'line_manager', 'colleague', 'other')),
  organisation text not null,
  role_title text,
  email text not null,
  phone text,
  is_most_recent_employer boolean not null default false,
  sort_order int not null default 0
);

create index if not exists hr_referees_app_idx on public.hr_referees (application_id);

create table if not exists public.hr_reference_requests (
  id uuid primary key default gen_random_uuid(),
  referee_id uuid not null unique references public.hr_referees(id) on delete cascade,
  application_id uuid not null references public.hr_applications(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'opened', 'received', 'declined', 'expired')),
  sent_at timestamptz,
  opened_at timestamptz,
  received_at timestamptz,
  expires_at timestamptz,
  reminders_sent int not null default 0,
  declined_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hr_reference_requests_app_idx on public.hr_reference_requests (application_id);

drop trigger if exists hr_reference_requests_set_updated_at on public.hr_reference_requests;
create trigger hr_reference_requests_set_updated_at
  before update on public.hr_reference_requests
  for each row execute function public.set_updated_at();

create table if not exists public.hr_reference_responses (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.hr_reference_requests(id) on delete cascade,
  application_id uuid not null references public.hr_applications(id) on delete cascade,
  capacity text not null check (capacity in ('principal', 'line_manager', 'colleague', 'other')),
  known_from date,
  known_to date,
  role_and_dates_confirmed boolean,
  role_and_dates_note text,
  -- 1 to 5 each: teaching, classroom_management, reliability, teamwork,
  -- parent_communication, professionalism. Checked in the app.
  ratings jsonb not null,
  concern boolean not null,
  concern_detail text,
  reason_for_leaving text,
  would_reemploy text not null check (would_reemploy in ('yes', 'no', 'not_applicable')),
  recommendation text not null check (recommendation in ('yes', 'with_reservations', 'no')),
  comments text,
  referee_name_confirmed text not null,
  ip_hash text,
  submitted_at timestamptz not null default now()
);

create index if not exists hr_reference_responses_app_idx on public.hr_reference_responses (application_id);

-- ---------------------------------------------------------------------------
-- Scores and interviews
-- ---------------------------------------------------------------------------

-- Append-only snapshots: what the score was, what it was computed from and
-- which flags stood, every time an input changed.
create table if not exists public.hr_application_scores (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.hr_applications(id) on delete cascade,
  version int not null,
  total numeric(5,2) not null,
  available int not null,
  breakdown jsonb not null,
  inputs jsonb not null,
  flags text[] not null default '{}'::text[],
  computed_at timestamptz not null default now(),
  unique (application_id, version)
);

create table if not exists public.hr_interviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.hr_applications(id) on delete cascade,
  campus_id uuid not null references public.campuses(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  mode text not null default 'in_person' check (mode in ('in_person', 'video', 'phone')),
  location text,
  panel text,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  ics_uid uuid not null default gen_random_uuid(),
  ics_sequence int not null default 0,
  notes text,
  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_interviews_times check (ends_at > starts_at)
);

create index if not exists hr_interviews_app_idx on public.hr_interviews (application_id);
create index if not exists hr_interviews_when_idx on public.hr_interviews (starts_at) where status = 'scheduled';

drop trigger if exists hr_interviews_set_updated_at on public.hr_interviews;
create trigger hr_interviews_set_updated_at
  before update on public.hr_interviews
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Duplicate answers.
--
-- Two applicants submitting near-identical text to the same question is the
-- one AI-writing signal that is reliable on its own: either both used the
-- same tool with the same prompt or one copied the other. Called by the
-- integrity job under the service role.
-- ---------------------------------------------------------------------------

create or replace function public.hr_similar_answers(p_answer_id uuid, p_threshold real default 0.8)
returns table (answer_id uuid, application_id uuid, similarity real)
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  select other.id, other.application_id, similarity(other.answer_text, me.answer_text)
    from public.hr_application_answers me
    join public.hr_application_answers other
      on other.vacancy_question_id = me.vacancy_question_id
     and other.application_id <> me.application_id
   where me.id = p_answer_id
     and length(me.answer_text) >= 200
     and length(other.answer_text) >= 200
     and similarity(other.answer_text, me.answer_text) >= p_threshold
   order by 3 desc
   limit 5
$$;

revoke execute on function public.hr_similar_answers(uuid, real) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS: staff read; everything is written by the HR app under the service role.
-- ---------------------------------------------------------------------------

alter table public.hr_vacancies enable row level security;
alter table public.hr_applications enable row level security;
alter table public.hr_application_events enable row level security;
alter table public.hr_application_notes enable row level security;
alter table public.hr_application_qualifications enable row level security;
alter table public.hr_application_employment enable row level security;
alter table public.hr_application_compliance enable row level security;
alter table public.hr_application_documents enable row level security;
alter table public.hr_question_banks enable row level security;
alter table public.hr_bank_questions enable row level security;
alter table public.hr_vacancy_questions enable row level security;
alter table public.hr_application_answers enable row level security;
alter table public.hr_referees enable row level security;
alter table public.hr_reference_requests enable row level security;
alter table public.hr_reference_responses enable row level security;
alter table public.hr_application_scores enable row level security;
alter table public.hr_interviews enable row level security;

-- Whether the caller may read this application: the permission and the
-- campus. A function rather than repeated joins so every child table asks the
-- same question the same way.
create or replace function public.hr_can_read_application(p_application_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_permission('hr.recruitment.read')
     and exists (
       select 1 from public.hr_applications a
        where a.id = p_application_id
          and public.can_access_campus(a.campus_id)
     )
$$;

revoke execute on function public.hr_can_read_application(uuid) from public, anon;
grant execute on function public.hr_can_read_application(uuid) to authenticated;

drop policy if exists hr_vacancies_select on public.hr_vacancies;
create policy hr_vacancies_select on public.hr_vacancies
  for select using (
    (select public.has_permission('hr.recruitment.read'))
    and public.can_access_campus(campus_id)
  );

drop policy if exists hr_applications_select on public.hr_applications;
create policy hr_applications_select on public.hr_applications
  for select using (
    (select public.has_permission('hr.recruitment.read'))
    and public.can_access_campus(campus_id)
  );

drop policy if exists hr_application_events_select on public.hr_application_events;
create policy hr_application_events_select on public.hr_application_events
  for select using (public.hr_can_read_application(application_id));

drop policy if exists hr_application_notes_select on public.hr_application_notes;
create policy hr_application_notes_select on public.hr_application_notes
  for select using (public.hr_can_read_application(application_id));

drop policy if exists hr_application_qualifications_select on public.hr_application_qualifications;
create policy hr_application_qualifications_select on public.hr_application_qualifications
  for select using (public.hr_can_read_application(application_id));

drop policy if exists hr_application_employment_select on public.hr_application_employment;
create policy hr_application_employment_select on public.hr_application_employment
  for select using (public.hr_can_read_application(application_id));

drop policy if exists hr_application_compliance_select on public.hr_application_compliance;
create policy hr_application_compliance_select on public.hr_application_compliance
  for select using (
    (select public.has_permission('hr.recruitment.compliance.read'))
    and public.hr_can_read_application(application_id)
  );

drop policy if exists hr_application_documents_select on public.hr_application_documents;
create policy hr_application_documents_select on public.hr_application_documents
  for select using (
    public.hr_can_read_application(application_id)
    -- Police clearance, permits and ID documents are compliance material.
    and (
      kind in ('cv', 'certificate', 'other')
      or (select public.has_permission('hr.recruitment.compliance.read'))
    )
  );

drop policy if exists hr_question_banks_select on public.hr_question_banks;
create policy hr_question_banks_select on public.hr_question_banks
  for select using ((select public.has_permission('hr.recruitment.read')));

drop policy if exists hr_bank_questions_select on public.hr_bank_questions;
create policy hr_bank_questions_select on public.hr_bank_questions
  for select using ((select public.has_permission('hr.recruitment.read')));

drop policy if exists hr_vacancy_questions_select on public.hr_vacancy_questions;
create policy hr_vacancy_questions_select on public.hr_vacancy_questions
  for select using (
    exists (
      select 1 from public.hr_vacancies v
       where v.id = hr_vacancy_questions.vacancy_id
         and (select public.has_permission('hr.recruitment.read'))
         and public.can_access_campus(v.campus_id)
    )
  );

drop policy if exists hr_application_answers_select on public.hr_application_answers;
create policy hr_application_answers_select on public.hr_application_answers
  for select using (public.hr_can_read_application(application_id));

drop policy if exists hr_referees_select on public.hr_referees;
create policy hr_referees_select on public.hr_referees
  for select using (public.hr_can_read_application(application_id));

drop policy if exists hr_reference_requests_select on public.hr_reference_requests;
create policy hr_reference_requests_select on public.hr_reference_requests
  for select using (public.hr_can_read_application(application_id));

drop policy if exists hr_reference_responses_select on public.hr_reference_responses;
create policy hr_reference_responses_select on public.hr_reference_responses
  for select using (public.hr_can_read_application(application_id));

drop policy if exists hr_application_scores_select on public.hr_application_scores;
create policy hr_application_scores_select on public.hr_application_scores
  for select using (public.hr_can_read_application(application_id));

drop policy if exists hr_interviews_select on public.hr_interviews;
create policy hr_interviews_select on public.hr_interviews
  for select using (public.hr_can_read_application(application_id));
