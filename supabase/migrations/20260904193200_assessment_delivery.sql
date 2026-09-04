-- Sitting an assessment: the frozen form, the attempt, the responses, the
-- scores.
--
-- Everything a child sees is copied out of the bank at launch into
-- `form_questions`, and every key into `form_answer_keys`. That is what makes
-- a result reproducible: the bank can be edited tomorrow and the form a
-- child sat today is unchanged, key included. The two tables have different
-- policies for the same reason `question_answers` does — the kiosk and the
-- assessor read the questions, and only an author reads the keys.
--
-- The timer is the server's. `expires_at` is set when the attempt starts and
-- every response and the submission are checked against it in the database,
-- so a browser with a stopped clock changes nothing.

-- ---------------------------------------------------------------------------
-- Forms
-- ---------------------------------------------------------------------------

create table if not exists public.assessment_forms (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  template_id uuid not null references public.assessment_templates(id) on delete restrict,
  template_version int not null,
  created_at timestamptz not null default now()
);

create index if not exists assessment_forms_application_idx on public.assessment_forms(application_id);

create table if not exists public.form_questions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.assessment_forms(id) on delete cascade,
  section_position int not null,
  section_title text not null,
  section_instructions text,
  section_time_limit_seconds int,
  -- True for the practice question shown before a section; never marked.
  is_practice boolean not null default false,
  position int not null,
  question_id uuid references public.questions(id) on delete set null,
  question_version int not null,
  competency_id uuid not null references public.competencies(id) on delete restrict,
  type text not null,
  stem text not null,
  stem_media_path text,
  -- {title, body, media_path} or null.
  passage_snapshot jsonb,
  -- [{id, label, media_path, side}] in the order the child sees them.
  options jsonb not null default '[]'::jsonb,
  marks numeric(5,2) not null,
  -- For extended_text: {max_marks, bands: [{key, label, min_marks, descriptor}]}.
  -- Descriptors only; the assessor needs them and holds no author permission.
  rubric_snapshot jsonb,
  unique (form_id, section_position, position)
);

create index if not exists form_questions_form_idx on public.form_questions(form_id, section_position, position);

-- ⚠️ Read by the marker under the service role and by authors. Nobody else.
create table if not exists public.form_answer_keys (
  form_question_id uuid primary key references public.form_questions(id) on delete cascade,
  answer jsonb,
  partial_credit boolean not null default false
);

-- ---------------------------------------------------------------------------
-- Attempts
-- ---------------------------------------------------------------------------

create table if not exists public.attempts (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete restrict,
  form_id uuid not null references public.assessment_forms(id) on delete restrict,
  status text not null default 'ready' check (status in (
    'ready', 'in_progress', 'submitted', 'marked', 'abandoned'
  )),
  marking_status text not null default 'pending' check (marking_status in (
    'pending', 'auto_marked', 'awaiting_rubric', 'complete'
  )),
  launched_by uuid references public.staff_profiles(id) on delete set null,
  launched_at timestamptz not null default now(),
  started_at timestamptz,
  submitted_at timestamptz,
  auto_submitted boolean not null default false,
  time_limit_seconds int not null check (time_limit_seconds > 0),
  -- 1.0 is standard; 1.5 gives 50% extra time. Recorded with the attempt so
  -- an accommodation is visible on the result.
  time_multiplier numeric(3,2) not null default 1.0 check (time_multiplier between 1.0 and 3.0),
  accommodation_note text,
  expires_at timestamptz,
  device_user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists attempts_set_updated_at on public.attempts;
create trigger attempts_set_updated_at
  before update on public.attempts
  for each row execute function public.set_updated_at();

-- One live attempt per booking. The rule, not a hint: a second Launch on the
-- same child is refused by the database.
create unique index if not exists attempts_one_live_per_booking_idx
  on public.attempts(booking_id)
  where status in ('ready', 'in_progress');

create index if not exists attempts_application_idx on public.attempts(application_id, created_at desc);
create index if not exists attempts_marking_idx on public.attempts(marking_status) where status in ('submitted', 'marked');

-- The short code a lab computer types to open an attempt. Hash only; the
-- raw code is shown once in the launch dialog. Single use.
create table if not exists public.kiosk_codes (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.attempt_responses (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  form_question_id uuid not null references public.form_questions(id) on delete cascade,
  response jsonb not null,
  answered_at timestamptz not null default now(),
  is_correct boolean,
  marks_awarded numeric(5,2),
  marking_method text check (marking_method is null or marking_method in ('auto', 'rubric')),
  marked_by uuid references public.staff_profiles(id) on delete set null,
  marked_at timestamptz,
  -- {band, rationale, model} from the writing-band suggester. Advice only.
  ai_suggestion jsonb,
  unique (attempt_id, form_question_id)
);

create index if not exists attempt_responses_attempt_idx on public.attempt_responses(attempt_id);

create table if not exists public.attempt_scores (
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  scope text not null check (scope in ('overall', 'subject', 'competency')),
  -- Polymorphic: a subject or competency id, null for overall. No FK.
  scope_id uuid,
  raw numeric(7,2) not null,
  max numeric(7,2) not null,
  percent numeric(5,2) not null,
  band text not null,
  computed_at timestamptz not null default now(),
  unique nulls not distinct (attempt_id, scope, scope_id),
  check ((scope = 'overall') = (scope_id is null))
);

-- ---------------------------------------------------------------------------
-- Launch: materialise the form and open the attempt, atomically
-- ---------------------------------------------------------------------------

-- Raises rather than returning a code, like book_session(). Messages are
-- stable and matched by the application layer: 'booking_not_checked_in',
-- 'template_not_active', 'template_empty', 'already_launched'.
create or replace function public.launch_attempt(
  p_application_id uuid,
  p_booking_id uuid,
  p_template_id uuid,
  p_time_multiplier numeric,
  p_launched_by uuid,
  p_accommodation_note text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  b public.bookings%rowtype;
  t public.assessment_templates%rowtype;
  s record;
  q record;
  v_grade_sort int;
  v_form_id uuid;
  v_attempt_id uuid;
  v_options jsonb;
  v_passage jsonb;
  v_rubric jsonb;
  v_answer jsonb;
  v_partial boolean;
  v_pos int;
  v_count int;
  v_mix jsonb;
  v_diff text;
  v_n int;
  v_ids uuid[];
begin
  -- The booking must be the child's, checked in, and not already sat.
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or b.application_id <> p_application_id or b.kind <> 'assessment' then
    raise exception 'booking_not_checked_in';
  end if;
  if b.status <> 'checked_in' then
    raise exception 'booking_not_checked_in';
  end if;

  select * into t from public.assessment_templates where id = p_template_id for share;
  if not found or t.status <> 'active' then
    raise exception 'template_not_active';
  end if;

  select g.sort_order into v_grade_sort
  from public.applications a join public.grades g on g.id = a.grade_id
  where a.id = p_application_id;

  insert into public.assessment_forms (application_id, template_id, template_version)
  values (p_application_id, t.id, t.version)
  returning id into v_form_id;

  for s in
    select * from public.template_sections where template_id = t.id order by position
  loop
    -- The practice question first, unmarked, if there is one.
    if s.practice_question_id is not null then
      v_ids := array[s.practice_question_id];
    else
      v_ids := '{}';
    end if;

    if s.selection = 'fixed' then
      v_ids := v_ids || array(
        select tsq.question_id
        from public.template_section_questions tsq
        join public.questions qq on qq.id = tsq.question_id
        where tsq.section_id = s.id and qq.status = 'active'
        order by tsq.position
      );
    else
      v_mix := s.random_difficulty_mix;
      if v_mix is not null and jsonb_typeof(v_mix) = 'object' then
        for v_diff, v_n in select key, (value)::int from jsonb_each_text(v_mix) loop
          v_ids := v_ids || array(
            select qq.id
            from public.questions qq
            join public.competencies c on c.id = qq.competency_id
            join public.question_banks bk on bk.id = qq.bank_id
            where qq.status = 'active' and bk.status = 'active'
              and c.subject_id = s.subject_id
              and qq.difficulty = v_diff::int
              and (qq.grade_sort_min is null or qq.grade_sort_min <= v_grade_sort)
              and (qq.grade_sort_max is null or qq.grade_sort_max >= v_grade_sort)
              and qq.id <> all(v_ids)
            order by random()
            limit v_n
          );
        end loop;
      else
        v_ids := v_ids || array(
          select qq.id
          from public.questions qq
          join public.competencies c on c.id = qq.competency_id
          join public.question_banks bk on bk.id = qq.bank_id
          where qq.status = 'active' and bk.status = 'active'
            and c.subject_id = s.subject_id
            and (qq.grade_sort_min is null or qq.grade_sort_min <= v_grade_sort)
            and (qq.grade_sort_max is null or qq.grade_sort_max >= v_grade_sort)
            and qq.id <> all(v_ids)
          order by random()
          limit coalesce(s.random_count, 0)
        );
      end if;
    end if;

    v_pos := 0;
    for q in
      select qq.*, ord.n
      from unnest(v_ids) with ordinality as ord(id, n)
      join public.questions qq on qq.id = ord.id
      order by ord.n
    loop
      v_pos := v_pos + 1;

      -- Options: shuffled for choice and ordering questions; for matching the
      -- left column keeps its order and the right is shuffled, so the child
      -- reads the prompts in the authored sequence and the answers are not.
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', o.id, 'label', o.label, 'media_path', o.media_path, 'side', o.side)
               order by case when q.type = 'matching' and o.side = 'left' then o.position else null end,
                        random()), '[]'::jsonb)
        into v_options
      from public.question_options o where o.question_id = q.id;

      select case when q.passage_id is null then null
                  else jsonb_build_object('title', p.title, 'body', p.body, 'media_path', p.media_path) end
        into v_passage
      from public.passages p where p.id = q.passage_id;

      select qa.answer, qa.partial_credit,
             case when qa.rubric_id is null then null
                  else jsonb_build_object('max_marks', r.max_marks, 'bands', r.bands) end
        into v_answer, v_partial, v_rubric
      from public.question_answers qa
      left join public.rubrics r on r.id = qa.rubric_id
      where qa.question_id = q.id;

      -- Ordering: the authored order is the key.
      if q.type = 'ordering' then
        select jsonb_build_object('order', coalesce(jsonb_agg(o.id order by o.position), '[]'::jsonb))
          into v_answer
        from public.question_options o where o.question_id = q.id;
      end if;

      insert into public.form_questions (
        form_id, section_position, section_title, section_instructions, section_time_limit_seconds,
        is_practice, position, question_id, question_version, competency_id, type, stem,
        stem_media_path, passage_snapshot, options, marks, rubric_snapshot
      ) values (
        v_form_id, s.position, s.title, s.instructions, s.time_limit_minutes * 60,
        (s.practice_question_id is not null and q.n = 1), v_pos, q.id, q.version, q.competency_id, q.type, q.stem,
        q.stem_media_path, v_passage, v_options, q.marks, v_rubric
      )
      returning id into v_attempt_id; -- reused as a scratch id below

      insert into public.form_answer_keys (form_question_id, answer, partial_credit)
      values (v_attempt_id, v_answer, coalesce(v_partial, false));
    end loop;
  end loop;

  select count(*) into v_count from public.form_questions where form_id = v_form_id and not is_practice;
  if v_count = 0 then
    raise exception 'template_empty';
  end if;

  insert into public.attempts (
    application_id, booking_id, form_id, launched_by, time_limit_seconds, time_multiplier, accommodation_note
  ) values (
    p_application_id, p_booking_id, v_form_id, p_launched_by,
    ceil(t.time_limit_minutes * 60 * p_time_multiplier)::int, p_time_multiplier, p_accommodation_note
  )
  returning id into v_attempt_id;

  update public.bookings set status = 'in_progress' where id = p_booking_id and status = 'checked_in';
  if not found then
    raise exception 'booking_not_checked_in';
  end if;

  return v_attempt_id;
exception
  when unique_violation then
    raise exception 'already_launched';
end;
$$;

-- The child (via the kiosk code) starts the clock.
create or replace function public.start_attempt(p_attempt_id uuid, p_user_agent text default null)
returns public.attempts
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  a public.attempts%rowtype;
begin
  select * into a from public.attempts where id = p_attempt_id for update;
  if not found then
    raise exception 'attempt_not_found';
  end if;
  if a.status = 'in_progress' then
    return a; -- a reload after starting is not a restart
  end if;
  if a.status <> 'ready' then
    raise exception 'attempt_not_ready';
  end if;
  update public.attempts
     set status = 'in_progress',
         started_at = now(),
         expires_at = now() + make_interval(secs => time_limit_seconds),
         device_user_agent = left(p_user_agent, 300)
   where id = p_attempt_id
   returning * into a;
  return a;
end;
$$;

-- A single answer. Refused once the server clock has passed the timer plus
-- the grace period. Upsert, so every keystroke-level autosave is one row.
create or replace function public.record_response(
  p_attempt_id uuid,
  p_form_question_id uuid,
  p_response jsonb,
  p_grace_seconds int default 30
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  a public.attempts%rowtype;
begin
  select * into a from public.attempts where id = p_attempt_id for share;
  if not found or a.status <> 'in_progress' then
    raise exception 'attempt_not_in_progress';
  end if;
  if now() > a.expires_at + make_interval(secs => p_grace_seconds) then
    raise exception 'attempt_expired';
  end if;
  if not exists (
    select 1 from public.form_questions fq
    where fq.id = p_form_question_id and fq.form_id = a.form_id and not fq.is_practice
  ) then
    raise exception 'question_not_in_form';
  end if;

  insert into public.attempt_responses (attempt_id, form_question_id, response)
  values (p_attempt_id, p_form_question_id, p_response)
  on conflict (attempt_id, form_question_id) do update
    set response = excluded.response,
        answered_at = now(),
        -- A changed answer must be re-marked.
        is_correct = null, marks_awarded = null, marking_method = null, marked_by = null, marked_at = null;
end;
$$;

-- Hands the paper in. Accepted at any time while the attempt is live — the
-- timer stops new answers, it does not stop the child finishing — and by the
-- expiry job on the child's behalf.
create or replace function public.submit_attempt(p_attempt_id uuid, p_auto boolean default false)
returns public.attempts
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  a public.attempts%rowtype;
begin
  select * into a from public.attempts where id = p_attempt_id for update;
  if not found then
    raise exception 'attempt_not_found';
  end if;
  if a.status not in ('ready', 'in_progress') then
    raise exception 'attempt_not_live';
  end if;
  update public.attempts
     set status = 'submitted',
         submitted_at = now(),
         started_at = coalesce(started_at, now()),
         auto_submitted = p_auto
   where id = p_attempt_id
   returning * into a;
  update public.bookings
     set status = 'completed', completed_at = now()
   where id = a.booking_id and status in ('checked_in', 'in_progress');
  return a;
end;
$$;

revoke execute on function public.launch_attempt(uuid, uuid, uuid, numeric, uuid, text) from public, anon, authenticated;
revoke execute on function public.start_attempt(uuid, text) from public, anon, authenticated;
revoke execute on function public.record_response(uuid, uuid, jsonb, int) from public, anon, authenticated;
revoke execute on function public.submit_attempt(uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.assessment_forms enable row level security;
alter table public.form_questions enable row level security;
alter table public.form_answer_keys enable row level security;
alter table public.attempts enable row level security;
alter table public.kiosk_codes enable row level security;
alter table public.attempt_responses enable row level security;
alter table public.attempt_scores enable row level security;

-- Staff who may see the applicant may see the sitting: the form, the
-- responses, the scores. No write policies for authenticated on any of
-- them — the kiosk writes under the service role, and rubric marks go
-- through the engine so the attempt's marking status follows.

drop policy if exists assessment_forms_select on public.assessment_forms;
create policy assessment_forms_select on public.assessment_forms
  for select using (
    exists (
      select 1 from public.applications a
      where a.id = assessment_forms.application_id
        and (select public.has_permission('applications.read'))
        and (select public.can_access_campus(a.campus_id))
    )
  );

drop policy if exists form_questions_select on public.form_questions;
create policy form_questions_select on public.form_questions
  for select using (
    exists (
      select 1 from public.assessment_forms f
      join public.applications a on a.id = f.application_id
      where f.id = form_questions.form_id
        and (select public.has_permission('applications.read'))
        and (select public.can_access_campus(a.campus_id))
    )
  );

-- ⚠️ Keys: authors only. See question_answers.
drop policy if exists form_answer_keys_select on public.form_answer_keys;
create policy form_answer_keys_select on public.form_answer_keys
  for select using ((select public.has_permission('assessments.author')));

drop policy if exists attempts_select on public.attempts;
create policy attempts_select on public.attempts
  for select using (
    exists (
      select 1 from public.applications a
      where a.id = attempts.application_id
        and (select public.has_permission('applications.read'))
        and (select public.can_access_campus(a.campus_id))
    )
  );

-- kiosk_codes: RLS on, no policies. Service role only.

drop policy if exists attempt_responses_select on public.attempt_responses;
create policy attempt_responses_select on public.attempt_responses
  for select using (
    exists (
      select 1 from public.attempts t
      join public.applications a on a.id = t.application_id
      where t.id = attempt_responses.attempt_id
        and (select public.has_permission('applications.read'))
        and (select public.can_access_campus(a.campus_id))
    )
  );

drop policy if exists attempt_scores_select on public.attempt_scores;
create policy attempt_scores_select on public.attempt_scores
  for select using (
    exists (
      select 1 from public.attempts t
      join public.applications a on a.id = t.application_id
      where t.id = attempt_scores.attempt_id
        and (select public.has_permission('applications.read'))
        and (select public.can_access_campus(a.campus_id))
    )
  );
