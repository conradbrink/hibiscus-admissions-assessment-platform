-- Development seed for Phase 2. NOT a migration: nothing here belongs in a
-- real school's database. It exists so the assessment → decision → offer
-- journey can be walked end to end on a laptop the day after the schema is
-- applied, before the school has authored a single question.
--
-- What it creates, all clearly labelled as samples:
--   - a question bank flagged `is_sample`, with one question of every type
--     for the Stage 1–6 band and a rubric for the writing item;
--   - an active assessment template for that band with three sections;
--   - an active fee schedule for Block 7 in the current academic year, with
--     placeholder amounts;
--   - a DRAFT ruleset, never activated, so the rules engine still routes
--     every assessed applicant to a person until the school sets thresholds.
--
-- Run once against a development database:
--   psql "$DATABASE_URL" -f supabase/seed/dev_phase2.sql
-- It refuses to run twice, and refuses if any non-sample bank exists.

do $$
declare
  v_bank uuid;
  v_rubric uuid;
  v_template uuid;
  v_section uuid;
  v_block7 uuid;
  v_year uuid;
  v_schedule uuid;
  v_ruleset uuid;
  c_reading uuid; c_comprehension uuid; c_vocabulary uuid; c_written uuid;
  c_number uuid; c_arithmetic uuid; c_patterns uuid; c_logic uuid;
  s_english uuid; s_maths uuid; s_reasoning uuid;
  q uuid;
  o1 uuid; o2 uuid; o3 uuid; o4 uuid; l1 uuid; l2 uuid; l3 uuid; r1 uuid; r2 uuid; r3 uuid;
begin
  if exists (select 1 from public.question_banks where is_sample) then
    raise notice 'dev_phase2: the sample bank already exists; nothing done.';
    return;
  end if;
  if exists (select 1 from public.question_banks where not is_sample) then
    raise exception 'dev_phase2: this database has real question banks. The sample seed is for empty development databases only.';
  end if;

  select id into s_english from public.subjects where code = 'english';
  select id into s_maths from public.subjects where code = 'mathematics';
  select id into s_reasoning from public.subjects where code = 'reasoning';
  select id into c_reading from public.competencies where code = 'reading';
  select id into c_comprehension from public.competencies where code = 'comprehension';
  select id into c_vocabulary from public.competencies where code = 'vocabulary';
  select id into c_written from public.competencies where code = 'written_language';
  select id into c_number from public.competencies where code = 'number_sense';
  select id into c_arithmetic from public.competencies where code = 'arithmetic';
  select id into c_patterns from public.competencies where code = 'patterns';
  select id into c_logic from public.competencies where code = 'logical_reasoning';
  select id into v_block7 from public.campuses where code = 'block7';
  select id into v_year from public.academic_years where is_current limit 1;
  if v_year is null then select id into v_year from public.academic_years order by starts_on limit 1; end if;
  if s_english is null or c_written is null or v_block7 is null or v_year is null then
    raise exception 'dev_phase2: reference data missing; apply the migrations first.';
  end if;

  -- -------------------------------------------------------------------------
  -- Bank, rubric, questions (grade band Stage 1–6: sort_order 60–110)
  -- -------------------------------------------------------------------------
  insert into public.question_banks (name, description, status, is_sample)
  values ('SAMPLE bank — Stage 1 to 6', 'Development sample. One question of each type so the kiosk, marker and profile can be exercised. Replace with the school''s own bank.', 'active', true)
  returning id into v_bank;

  insert into public.rubrics (name, competency_id, max_marks, bands)
  values (
    'SAMPLE writing rubric (6 marks)', c_written, 6,
    '[
      {"key": "emerging",   "label": "Emerging",   "min_marks": 0, "descriptor": "A few words or a single idea. Little sentence structure."},
      {"key": "developing", "label": "Developing", "min_marks": 2, "descriptor": "Two or more related sentences. Some punctuation. The idea can be followed."},
      {"key": "secure",     "label": "Secure",     "min_marks": 4, "descriptor": "A short, ordered piece with sentences that mostly make sense. Capital letters and full stops used."},
      {"key": "extending",  "label": "Extending",  "min_marks": 6, "descriptor": "Clear, sequenced writing with varied vocabulary and consistent punctuation."}
    ]'::jsonb
  ) returning id into v_rubric;

  -- 1. single_choice (Reading)
  insert into public.questions (bank_id, competency_id, type, stem, marks, difficulty, grade_sort_min, grade_sort_max, status)
  values (v_bank, c_reading, 'single_choice', 'Which word rhymes with "cat"?', 1, 2, 60, 110, 'active') returning id into q;
  insert into public.question_options (question_id, position, label) values (q, 1, 'dog') returning id into o1;
  insert into public.question_options (question_id, position, label) values (q, 2, 'hat') returning id into o2;
  insert into public.question_options (question_id, position, label) values (q, 3, 'sun') returning id into o3;
  insert into public.question_answers (question_id, answer) values (q, jsonb_build_object('option_ids', jsonb_build_array(o2)));

  -- 2. multi_select (Vocabulary)
  insert into public.questions (bank_id, competency_id, type, stem, marks, difficulty, grade_sort_min, grade_sort_max, status)
  values (v_bank, c_vocabulary, 'multi_select', 'Choose all the words that mean "big".', 2, 3, 60, 110, 'active') returning id into q;
  insert into public.question_options (question_id, position, label) values (q, 1, 'large') returning id into o1;
  insert into public.question_options (question_id, position, label) values (q, 2, 'tiny') returning id into o2;
  insert into public.question_options (question_id, position, label) values (q, 3, 'huge') returning id into o3;
  insert into public.question_options (question_id, position, label) values (q, 4, 'quiet') returning id into o4;
  insert into public.question_answers (question_id, answer, partial_credit) values (q, jsonb_build_object('option_ids', jsonb_build_array(o1, o3)), true);

  -- 3. short_text (Comprehension, with a passage)
  insert into public.passages (bank_id, title, body) values (v_bank, 'SAMPLE: The Red Kite', 'Naledi made a red kite with her grandfather. On Saturday the wind was strong, so they walked to the top of the hill. The kite flew so high that it looked like a small red bird.') returning id into o1;
  insert into public.questions (bank_id, competency_id, passage_id, type, stem, marks, difficulty, grade_sort_min, grade_sort_max, status)
  values (v_bank, c_comprehension, o1, 'short_text', 'What colour was the kite?', 1, 2, 60, 110, 'active') returning id into q;
  insert into public.question_answers (question_id, answer) values (q, '{"accepted": ["red", "it was red", "a red kite"]}'::jsonb);

  -- 4. numeric (Arithmetic)
  insert into public.questions (bank_id, competency_id, type, stem, marks, difficulty, grade_sort_min, grade_sort_max, status)
  values (v_bank, c_arithmetic, 'numeric', 'What is 27 + 15?', 1, 3, 60, 110, 'active') returning id into q;
  insert into public.question_answers (question_id, answer) values (q, '{"value": 42, "tolerance": 0}'::jsonb);

  -- 5. matching (Number Sense)
  insert into public.questions (bank_id, competency_id, type, stem, marks, difficulty, grade_sort_min, grade_sort_max, status)
  values (v_bank, c_number, 'matching', 'Match each number to its word.', 3, 2, 60, 110, 'active') returning id into q;
  insert into public.question_options (question_id, position, label, side) values (q, 1, '7', 'left') returning id into l1;
  insert into public.question_options (question_id, position, label, side) values (q, 2, '12', 'left') returning id into l2;
  insert into public.question_options (question_id, position, label, side) values (q, 3, '20', 'left') returning id into l3;
  insert into public.question_options (question_id, position, label, side) values (q, 1, 'twelve', 'right') returning id into r1;
  insert into public.question_options (question_id, position, label, side) values (q, 2, 'twenty', 'right') returning id into r2;
  insert into public.question_options (question_id, position, label, side) values (q, 3, 'seven', 'right') returning id into r3;
  insert into public.question_answers (question_id, answer, partial_credit)
  values (q, jsonb_build_object('pairs', jsonb_build_array(jsonb_build_array(l1, r3), jsonb_build_array(l2, r1), jsonb_build_array(l3, r2))), true);

  -- 6. ordering (Patterns) — the authored order is the key
  insert into public.questions (bank_id, competency_id, type, stem, marks, difficulty, grade_sort_min, grade_sort_max, status)
  values (v_bank, c_patterns, 'ordering', 'Put these numbers in order from smallest to largest.', 2, 2, 60, 110, 'active') returning id into q;
  insert into public.question_options (question_id, position, label) values (q, 1, '3') returning id into o1;
  insert into public.question_options (question_id, position, label) values (q, 2, '8') returning id into o2;
  insert into public.question_options (question_id, position, label) values (q, 3, '15') returning id into o3;
  insert into public.question_options (question_id, position, label) values (q, 4, '21') returning id into o4;
  insert into public.question_answers (question_id, answer, partial_credit) values (q, jsonb_build_object('order', jsonb_build_array(o1, o2, o3, o4)), true);

  -- 7. extended_text (Written Language) — rubric, no key
  insert into public.questions (bank_id, competency_id, type, stem, marks, difficulty, grade_sort_min, grade_sort_max, status)
  values (v_bank, c_written, 'extended_text', 'Write three or four sentences about your favourite day.', 6, 3, 60, 110, 'active') returning id into q;
  insert into public.question_answers (question_id, answer, rubric_id) values (q, null, v_rubric);

  -- 8. single_choice (Logical Reasoning) — a second choice item so a random section has something to draw
  insert into public.questions (bank_id, competency_id, type, stem, marks, difficulty, grade_sort_min, grade_sort_max, status)
  values (v_bank, c_logic, 'single_choice', 'All the birds in the tree are blue. Tumi sees a bird fly out of the tree. What colour is it?', 1, 3, 60, 110, 'active') returning id into q;
  insert into public.question_options (question_id, position, label) values (q, 1, 'Blue') returning id into o1;
  insert into public.question_options (question_id, position, label) values (q, 2, 'Red') returning id into o2;
  insert into public.question_options (question_id, position, label) values (q, 3, 'It cannot be known') returning id into o3;
  insert into public.question_answers (question_id, answer) values (q, jsonb_build_object('option_ids', jsonb_build_array(o1)));

  -- -------------------------------------------------------------------------
  -- Template: three fixed sections, one per subject
  -- -------------------------------------------------------------------------
  insert into public.assessment_templates (name, description, grade_sort_min, grade_sort_max, time_limit_minutes, status)
  values ('SAMPLE Stage 1–6 sitting', 'Development sample covering every question type. Retire it once a real template is active.', 60, 110, 30, 'active')
  returning id into v_template;

  insert into public.template_sections (template_id, position, title, subject_id, instructions, selection, practice_question_id)
  values (v_template, 1, 'English', s_english, 'Read each question carefully. Choose or type your answer, then press Next.', 'fixed',
          (select id from public.questions where bank_id = v_bank and type = 'single_choice' and competency_id = c_reading))
  returning id into v_section;
  insert into public.template_section_questions (section_id, question_id, position)
  select v_section, id, row_number() over (order by created_at)
  from public.questions where bank_id = v_bank and competency_id in (c_reading, c_vocabulary, c_comprehension, c_written);

  insert into public.template_sections (template_id, position, title, subject_id, instructions, selection)
  values (v_template, 2, 'Mathematics', s_maths, 'Work out each answer. You may use the paper on your desk.', 'fixed')
  returning id into v_section;
  insert into public.template_section_questions (section_id, question_id, position)
  select v_section, id, row_number() over (order by created_at)
  from public.questions where bank_id = v_bank and competency_id in (c_arithmetic, c_number, c_patterns);

  insert into public.template_sections (template_id, position, title, subject_id, instructions, selection, random_count)
  values (v_template, 3, 'Reasoning', s_reasoning, 'Think carefully before you answer.', 'random', 1)
  returning id into v_section;

  -- -------------------------------------------------------------------------
  -- Fees: Block 7, current year, every grade. Placeholder amounts.
  -- -------------------------------------------------------------------------
  insert into public.fee_schedules (name, campus_id, academic_year_id, currency, status)
  values ('SAMPLE Block 7 fees (placeholder amounts)', v_block7, v_year, 'BWP', 'active')
  returning id into v_schedule;
  insert into public.fee_lines (schedule_id, code, label, amount_minor, payable_at_acceptance, position) values
    (v_schedule, 'registration',   'Registration fee',  250000,  true,  1),
    (v_schedule, 'admission',      'Admission fee',     500000,  true,  2),
    (v_schedule, 'tuition_annual', 'Annual tuition',   4800000,  false, 3);

  -- -------------------------------------------------------------------------
  -- Ruleset: a DRAFT the school can read and edit. Deliberately not active.
  -- -------------------------------------------------------------------------
  insert into public.admission_rulesets (name, description, status)
  values ('SAMPLE thresholds (draft)', 'Illustrates the rule shapes. Thresholds are the school''s to set; activate only once agreed.', 'draft')
  returning id into v_ruleset;
  insert into public.admission_rules (ruleset_id, scope, scope_id, operator, threshold, severity, label, position) values
    (v_ruleset, 'overall', null,      '>=', 40, 'hard_fail', 'Overall score at least 40%',              1),
    (v_ruleset, 'overall', null,      '>=', 60, 'review',    'Overall below 60% is reviewed by a person', 2),
    (v_ruleset, 'subject', s_english, '>=', 50, 'review',    'English below 50% is reviewed by a person', 3);

  raise notice 'dev_phase2: sample bank, template, Block 7 fee schedule and draft ruleset created.';
end
$$;
