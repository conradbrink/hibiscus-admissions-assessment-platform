-- Story assessments: the read-aloud, adult-marked papers for Reception to
-- Stage 3, delivered as chapters of one story with a character who talks.
--
-- Nothing about launching, sitting, marking or scoring changes shape. A story
-- template is an assessment template whose sections are scenes and whose
-- questions carry what the character says, how the child answers, and what
-- the adult should look for. The form a child sat snapshots all of that, the
-- same way it snapshots the stem, so a chapter can be rewritten tomorrow
-- without touching a result from today.
--
-- One new question type, `adult_marked`: the adult sitting with the child
-- records the outcome (correct, partly, not yet, skipped) and the marker
-- turns that into marks. Its "key" is the expected answer as words, for the
-- adult's eyes; it is never compared to anything by code.

-- ---------------------------------------------------------------------------
-- Early years strands
-- ---------------------------------------------------------------------------

insert into public.subjects (code, name, sort_order) values
  ('personal_social', 'Personal and social', 40)
on conflict (code) do nothing;

insert into public.competencies (subject_id, code, name, focus_label, sort_order)
select s.id, c.code, c.name, c.focus_label, c.sort_order
from (values
  ('english',         'talking_listening', 'Talking and listening', 'Talking and listening',      5),
  ('english',         'sounds_letters',    'Sounds and letters',    'Sounds and letters',         15),
  ('mathematics',     'measures_data',     'Measures and data',     'Measures and data',          45),
  ('personal_social', 'getting_on',        'Getting on',            'Settling and confidence',    10)
) as c(subject_code, code, name, focus_label, sort_order)
join public.subjects s on s.code = c.subject_code
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Templates and sections: a chapter and its scenes
-- ---------------------------------------------------------------------------

alter table public.assessment_templates
  add column if not exists delivery text not null default 'paper',
  add column if not exists story_character text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'assessment_templates_delivery_check') then
    alter table public.assessment_templates
      add constraint assessment_templates_delivery_check check (delivery in ('paper', 'story'));
  end if;
end $$;

comment on column public.assessment_templates.delivery is
  'paper: the child works through questions on screen. story: scenes with a talking character; an adult marks alongside.';

alter table public.template_sections
  add column if not exists scene_key text,
  add column if not exists narration text,
  add column if not exists stop_after_misses int;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'template_sections_stop_after_misses_check') then
    alter table public.template_sections
      add constraint template_sections_stop_after_misses_check
      check (stop_after_misses is null or stop_after_misses > 0);
  end if;
end $$;

comment on column public.template_sections.scene_key is 'Which drawn scene the player shows; the player owns the list.';
comment on column public.template_sections.narration is 'What the character says as the scene opens.';
comment on column public.template_sections.stop_after_misses is
  'Story mode: stop asking a competency after this many wrong answers in a row.';

-- ---------------------------------------------------------------------------
-- Questions: what the character says, how the child answers
-- ---------------------------------------------------------------------------

alter table public.questions
  add column if not exists external_code text,
  add column if not exists narration text,
  add column if not exists answer_mode text,
  add column if not exists scene_focus text[],
  add column if not exists adult_note text;

create unique index if not exists questions_external_code_idx on public.questions(external_code) where external_code is not null;

do $$
declare
  v_name text;
begin
  -- The type list gains adult_marked. The original constraint was unnamed,
  -- so find it by its definition rather than guessing the name.
  select conname into v_name
  from pg_constraint
  where conrelid = 'public.questions'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%single_choice%';
  if v_name is not null then
    execute format('alter table public.questions drop constraint %I', v_name);
  end if;
  alter table public.questions add constraint questions_type_check check (type in (
    'single_choice', 'multi_select', 'numeric', 'short_text', 'matching', 'ordering', 'extended_text', 'adult_marked'
  ));
  if not exists (select 1 from pg_constraint where conname = 'questions_answer_mode_check') then
    alter table public.questions add constraint questions_answer_mode_check
      check (answer_mode is null or answer_mode in ('adult', 'rating', 'tap', 'type', 'drag'));
  end if;
end $$;

comment on column public.questions.external_code is 'Stable code for seeded content (R-T3); the seed upserts by it.';
comment on column public.questions.narration is 'Story mode: what the character says for this item. The stem stays the adult-facing wording.';
comment on column public.questions.answer_mode is
  'Story mode: adult (adult marks a spoken or pointed answer), rating (adult rates yes/partly/not yet), tap, type, drag.';
comment on column public.questions.scene_focus is 'Story mode: keys of the drawn objects the scene highlights for this item.';
comment on column public.questions.adult_note is 'Story mode: what the adult should look for; shown on the marking strip, never to the child.';

-- Narration changes what the child heard, so it bumps the version too.
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
     or new.passage_id is distinct from old.passage_id
     or new.narration is distinct from old.narration
     or new.answer_mode is distinct from old.answer_mode then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The frozen form carries the story fields
-- ---------------------------------------------------------------------------

alter table public.form_questions
  add column if not exists section_scene_key text,
  add column if not exists section_narration text,
  add column if not exists section_stop_after_misses int,
  add column if not exists narration text,
  add column if not exists answer_mode text,
  add column if not exists scene_focus text[],
  add column if not exists adult_note text,
  add column if not exists difficulty int not null default 3;

-- launch_attempt, unchanged in behaviour, now copies the story fields.
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

      if q.type = 'ordering' then
        select jsonb_build_object('order', coalesce(jsonb_agg(o.id order by o.position), '[]'::jsonb))
          into v_answer
        from public.question_options o where o.question_id = q.id;
      end if;

      insert into public.form_questions (
        form_id, section_position, section_title, section_instructions, section_time_limit_seconds,
        section_scene_key, section_narration, section_stop_after_misses,
        is_practice, position, question_id, question_version, competency_id, type, stem,
        stem_media_path, passage_snapshot, options, marks, rubric_snapshot,
        narration, answer_mode, scene_focus, adult_note, difficulty
      ) values (
        v_form_id, s.position, s.title, s.instructions, s.time_limit_minutes * 60,
        s.scene_key, s.narration, s.stop_after_misses,
        (s.practice_question_id is not null and q.n = 1), v_pos, q.id, q.version, q.competency_id, q.type, q.stem,
        q.stem_media_path, v_passage, v_options, q.marks, v_rubric,
        q.narration, q.answer_mode, q.scene_focus, q.adult_note, q.difficulty
      )
      returning id into v_attempt_id;

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

revoke execute on function public.launch_attempt(uuid, uuid, uuid, numeric, uuid, text) from public, anon, authenticated;
