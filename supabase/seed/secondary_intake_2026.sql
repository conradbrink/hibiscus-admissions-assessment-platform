-- Secondary intake tests, 2026: the school's own English and Mathematics
-- entrance papers for Form 1 to Form 4, transcribed from the Word documents
-- supplied by the school in September 2026. NOT a migration: this is
-- content, loaded once with psql (or the SQL console) and then maintained
-- through Set up → Question banks and Set up → Assessments.
--
-- What it creates:
--   - one question bank, "Secondary intake tests 2026", with four English
--     papers (each a passage plus Parts A, B and C) and four Mathematics
--     papers (ten multiple-choice items plus Section B);
--   - one rubric per marker-judged question, whose band descriptors carry
--     the school's model answer, so the person marking sees the key beside
--     the child's writing; Part C carries draft writing bands that the school
--     should confirm;
--   - four templates, one per intake year, each with a 20-minute English
--     section and a 20-minute Mathematics section.
--
-- Transcription notes (also reported to the school):
--   - Marker-judged questions (extended_text) are used wherever the marking
--     key gives a model answer rather than an exact word.
--   - Corrections made on the school's instruction (7 September 2026), each
--     marked "corrected" in a comment below: two marking keys that
--     contradicted the passage (Form 2 English B3, Form 3 English B3), one
--     Section B question whose wording contradicted its numbers (Form 4
--     Maths B1), and four multiple-choice items whose printed options held
--     no single correct answer (Form 1 Maths Q5 and Q7, Form 4 Maths Q1
--     and Q7), where one distractor was replaced by the intended answer.
--   - Multiple-choice answer keys for the Mathematics papers were not
--     supplied; the answers here were worked from the questions.
--
-- Refuses to run twice.

create or replace function pg_temp.comp(p_code text) returns uuid language sql as $$
  select id from public.competencies where code = p_code
$$;

create or replace function pg_temp.add_q(
  p_bank uuid, p_comp uuid, p_passage uuid, p_type text, p_stem text, p_marks numeric,
  p_gmin int, p_gmax int, p_status text default 'active'
) returns uuid language plpgsql as $$
declare q uuid;
begin
  insert into public.questions (bank_id, competency_id, passage_id, type, stem, marks, difficulty, grade_sort_min, grade_sort_max, status)
  values (p_bank, p_comp, p_passage, p_type, p_stem, p_marks, 3, p_gmin, p_gmax, p_status)
  returning id into q;
  return q;
end $$;

create or replace function pg_temp.add_choice(p_q uuid, p_options text[], p_correct int[], p_partial boolean default false)
returns void language plpgsql as $$
declare i int; oid uuid; ids uuid[] := '{}';
begin
  for i in 1..array_length(p_options, 1) loop
    insert into public.question_options (question_id, position, label) values (p_q, i, p_options[i]) returning id into oid;
    if i = any(p_correct) then ids := ids || oid; end if;
  end loop;
  insert into public.question_answers (question_id, answer, partial_credit)
  values (p_q, jsonb_build_object('option_ids', to_jsonb(ids)), p_partial);
end $$;

create or replace function pg_temp.add_short(p_q uuid, p_accepted text[]) returns void language sql as $$
  insert into public.question_answers (question_id, answer) values (p_q, jsonb_build_object('accepted', to_jsonb(p_accepted)))
$$;

create or replace function pg_temp.add_num(p_q uuid, p_value numeric, p_tol numeric default 0) returns void language sql as $$
  insert into public.question_answers (question_id, answer) values (p_q, jsonb_build_object('value', p_value, 'tolerance', p_tol))
$$;

create or replace function pg_temp.add_rubric(p_q uuid, p_name text, p_comp uuid, p_max numeric, p_bands jsonb) returns void language plpgsql as $$
declare r uuid;
begin
  insert into public.rubrics (name, competency_id, max_marks, bands) values (p_name, p_comp, p_max, p_bands) returning id into r;
  insert into public.question_answers (question_id, answer, rubric_id) values (p_q, null, r);
end $$;

-- A one-mark model answer: right or not.
create or replace function pg_temp.bands1(p_full text) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('key', 'b0', 'label', 'No credit', 'min_marks', 0, 'descriptor', 'Not answered, or does not give the expected point.'),
    jsonb_build_object('key', 'b1', 'label', 'Full marks', 'min_marks', 1, 'descriptor', p_full))
$$;

-- A two-mark model answer: one point or both.
create or replace function pg_temp.bands2(p_half text, p_full text) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('key', 'b0', 'label', 'No credit', 'min_marks', 0, 'descriptor', 'Not answered, or neither point made.'),
    jsonb_build_object('key', 'b1', 'label', 'One mark', 'min_marks', 1, 'descriptor', p_half),
    jsonb_build_object('key', 'b2', 'label', 'Full marks', 'min_marks', 2, 'descriptor', p_full))
$$;

-- Part C: 20 marks across content, grammar, sentences and vocabulary. The
-- paper names the four criteria but gives no descriptors, so these are a
-- draft for the school to confirm or rewrite under Set up → Rubrics.
create or replace function pg_temp.bands_writing() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('key', 'b0',  'label', 'Nothing to mark', 'min_marks', 0,  'descriptor', 'No paragraph written, or nothing that can be read as an answer to the topic.'),
    jsonb_build_object('key', 'b4',  'label', 'Beginning',       'min_marks', 4,  'descriptor', 'Content: fewer sentences than asked for and little to say about the topic. Grammar: frequent errors that get in the way of meaning. Sentences: fragments or one repeated pattern. Vocabulary: very simple and repetitive.'),
    jsonb_build_object('key', 'b8',  'label', 'Developing',      'min_marks', 8,  'descriptor', 'Content: the paragraph is attempted and mostly on topic but plain. Grammar: several errors, meaning still clear. Sentences: simple sentences, little variety. Vocabulary: limited, some words misused.'),
    jsonb_build_object('key', 'b12', 'label', 'Secure',          'min_marks', 12, 'descriptor', 'Content: a full paragraph on topic with relevant detail. Grammar: mostly accurate. Sentences: some variety in length and structure. Vocabulary: adequate and used correctly.'),
    jsonb_build_object('key', 'b16', 'label', 'Strong',          'min_marks', 16, 'descriptor', 'Content: well organised, detailed and interesting. Grammar: accurate with rare slips. Sentences: varied and well controlled. Vocabulary: good range, chosen with care.'),
    jsonb_build_object('key', 'b20', 'label', 'Excellent',       'min_marks', 20, 'descriptor', 'Content: fully developed, engaging and precisely on topic. Grammar: accurate throughout. Sentences: varied, fluent and deliberately shaped. Vocabulary: precise and ambitious.'))
$$;

create or replace function pg_temp.add_section(
  p_template uuid, p_position int, p_title text, p_subject uuid, p_instructions text, p_minutes int, p_questions uuid[]
) returns void language plpgsql as $$
declare s uuid; i int;
begin
  insert into public.template_sections (template_id, position, title, subject_id, instructions, time_limit_minutes, selection)
  values (p_template, p_position, p_title, p_subject, p_instructions, p_minutes, 'fixed')
  returning id into s;
  for i in 1..array_length(p_questions, 1) loop
    insert into public.template_section_questions (section_id, question_id, position) values (s, p_questions[i], i);
  end loop;
end $$;

do $$
declare
  v_bank uuid;
  v_passage uuid;
  q uuid;
  s_english uuid := (select id from public.subjects where code = 'english');
  s_maths uuid := (select id from public.subjects where code = 'mathematics');
  c_comp uuid := pg_temp.comp('comprehension');
  c_gram uuid := pg_temp.comp('grammar');
  c_writ uuid := pg_temp.comp('written_language');
  c_read uuid := pg_temp.comp('reading');
  c_num uuid := pg_temp.comp('number_sense');
  c_arith uuid := pg_temp.comp('arithmetic');
  c_geom uuid := pg_temp.comp('geometry');
  c_prob uuid := pg_temp.comp('problem_solving');
  c_patt uuid := pg_temp.comp('patterns');
  -- grades.sort_order: Form 1 = 130, Form 2 = 140, Form 3 = 150, Form 4 = 160, Form 5 = 170
  eng1 uuid[] := '{}'; eng2 uuid[] := '{}'; eng3 uuid[] := '{}'; eng4 uuid[] := '{}';
  mat1 uuid[] := '{}'; mat2 uuid[] := '{}'; mat3 uuid[] := '{}'; mat4 uuid[] := '{}';
  v_template uuid;
  eng_instructions text := 'Read the passage carefully, then answer every question. Part A asks about the passage, Part B is grammar, and Part C is a short piece of writing. You have 20 minutes for this section.';
  maths_instructions text := 'Questions 1 to 10: choose the best answer. Section B: work out each answer; you may use the paper on your desk. You have 20 minutes for this section.';
begin
  if s_english is null or s_maths is null or c_comp is null or c_gram is null or c_writ is null
     or c_num is null or c_arith is null or c_geom is null or c_prob is null or c_patt is null then
    raise exception 'Reference data missing: run the migrations first.';
  end if;
  if exists (select 1 from public.question_banks where name = 'Secondary intake tests 2026') then
    raise exception 'The bank "Secondary intake tests 2026" already exists. Edit it under Set up → Question banks rather than loading it again.';
  end if;

  insert into public.question_banks (name, description, status, is_sample)
  values ('Secondary intake tests 2026',
          'The school''s English and Mathematics intake papers for Form 1 to Form 4, as supplied in September 2026. Part A and Part C answers are marked by a person against the model answers shown in each rubric.',
          'active', false)
  returning id into v_bank;

  -- =========================================================================
  -- English: Stage 6/7 to Form 1  (applicants to Form 1, sort 130)
  -- =========================================================================
  insert into public.passages (bank_id, title, body) values (v_bank,
    'Extract from ''The Iron Woman'' by Ted Hughes',
$t$Read this extract in about 3 minutes, then answer the questions that follow.

In Lucy’s attic bedroom, it was pitch black. If she had been awake, she might have heard a skylark singing high above the house. But Lucy was trapped in a nightmare, sensing someone climbing the attic stairs. A hand tried the stiff latch on the door, clicking and rattling but not opening.

Then the latch clacked loudly, and the door swung wide. Lucy, now silent, seemed to stop breathing. The room remained dark and silent except for the faint skylark song.

In her dream, a hand touched Lucy's shoulder. She turned to see a dreadful figure, initially resembling a seal covered in oil, but then realized it was a girl, a little younger than her, shaking her and crying, "Wake up! Oh, please wake up!"

Lucy jolted awake, panting from the peculiar dream. She pulled the bedclothes close and stared into the darkness. Was the door open? She knew it had been closed every night, but now...$t$)
  returning id into v_passage;

  -- Part A (10 marks)
  q := pg_temp.add_q(v_bank, c_comp, v_passage, 'extended_text', 'Part A, question 1. What sound might Lucy have heard if she had been awake in her attic bedroom? (1 mark)', 1, 130, 130);
  perform pg_temp.add_rubric(q, 'Form 1 English A1', c_comp, 1, pg_temp.bands1('A skylark singing high above the house.'));
  eng1 := eng1 || q;

  q := pg_temp.add_q(v_bank, c_comp, v_passage, 'extended_text', 'Part A, question 2. What sensations does Lucy experience as she senses someone climbing the attic stairs in her nightmare? (1 mark)', 1, 130, 130);
  perform pg_temp.add_rubric(q, 'Form 1 English A2', c_comp, 1, pg_temp.bands1('She feels trapped in a nightmare and senses someone climbing the stairs, and a hand trying the stiff latch on the door, clicking and rattling.'));
  eng1 := eng1 || q;

  q := pg_temp.add_q(v_bank, c_comp, v_passage, 'extended_text', 'Part A, question 3. Initially, what does Lucy think the dreadful figure in her dream resembles, and what does she eventually realise? (2 marks)', 2, 130, 130);
  perform pg_temp.add_rubric(q, 'Form 1 English A3', c_comp, 2, pg_temp.bands2('One of the two points: a seal covered in oil; a girl a little younger than her.', 'Both points: at first a seal covered in oil; then she realises it is a girl a little younger than her.'));
  eng1 := eng1 || q;

  q := pg_temp.add_q(v_bank, c_comp, v_passage, 'extended_text', 'Part A, question 4. What does the girl in Lucy''s dream cry out to her, and how does Lucy respond to this? (2 marks)', 2, 130, 130);
  perform pg_temp.add_rubric(q, 'Form 1 English A4', c_comp, 2, pg_temp.bands2('One of the two points: the words "Wake up! Oh, please wake up!"; Lucy jolts awake, panting.', 'Both points: the girl cries "Wake up! Oh, please wake up!", and Lucy jolts awake, panting from the dream.'));
  eng1 := eng1 || q;

  q := pg_temp.add_q(v_bank, c_comp, v_passage, 'extended_text', 'Part A, question 5. After waking up, what is Lucy''s concern regarding the state of her bedroom door, and what does this indicate about her feelings? (2 marks)', 2, 130, 130);
  perform pg_temp.add_rubric(q, 'Form 1 English A5', c_comp, 2, pg_temp.bands2('One of the two points: she wonders whether the door is open although it is closed every night; this shows fear or uncertainty.', 'Both points: she is worried the door may be open even though she knows it is closed every night, which shows her fear and uncertainty after the nightmare.'));
  eng1 := eng1 || q;

  q := pg_temp.add_q(v_bank, c_read, v_passage, 'multi_select',
$t$Part A, question 6. This line describes part of the setting at the beginning of the story. Look at the underlined words:

"...the lark, far up there, catching the first rays of the sun, that peered at the bird from behind the world."

(Underlined: "catching the first rays of the sun, that peered at the bird from behind the world")

Tick the TWO techniques being used here. (2 marks)$t$, 2, 130, 130);
  perform pg_temp.add_choice(q, array['Alliteration', 'Imagery', 'Metaphor', 'Simile', 'Personification'], array[2, 5], true);
  eng1 := eng1 || q;

  -- Part B (6 marks)
  q := pg_temp.add_q(v_bank, c_gram, v_passage, 'extended_text', 'Part B, question 1. Identify the subject and the verb in the sentence: "Lucy was trapped in a nightmare." (2 marks)', 2, 130, 130);
  perform pg_temp.add_rubric(q, 'Form 1 English B1', c_gram, 2, pg_temp.bands2('One of the two: subject "Lucy"; verb "was trapped".', 'Both: the subject is "Lucy" and the verb is "was trapped".'));
  eng1 := eng1 || q;

  q := pg_temp.add_q(v_bank, c_gram, v_passage, 'short_text', 'Part B, question 2. What tense is used in the sentence "The room remained dark and silent"? (1 mark)', 1, 130, 130);
  perform pg_temp.add_short(q, array['past', 'past tense', 'the past tense', 'simple past', 'past simple', 'simple past tense', 'past simple tense', 'the simple past', 'the past simple']);
  eng1 := eng1 || q;

  q := pg_temp.add_q(v_bank, c_gram, v_passage, 'single_choice', 'Part B, question 3. In the phrase "a dreadful figure, initially resembling a seal covered in oil," what part of speech is the word "dreadful"? (1 mark)', 1, 130, 130);
  perform pg_temp.add_choice(q, array['preposition', 'adjective', 'verb'], array[2]);
  eng1 := eng1 || q;

  q := pg_temp.add_q(v_bank, c_gram, v_passage, 'short_text', 'Part B, question 4. What is the present tense of "jolted" in the sentence "Lucy jolted awake, panting from the peculiar dream"? (1 mark)', 1, 130, 130);
  perform pg_temp.add_short(q, array['jolts', 'jolt']);
  eng1 := eng1 || q;

  q := pg_temp.add_q(v_bank, c_gram, v_passage, 'single_choice', 'Part B, question 5. What type of sentence is "Was the door open?" (1 mark)', 1, 130, 130);
  perform pg_temp.add_choice(q, array['Question', 'Statement'], array[1]);
  eng1 := eng1 || q;

  -- Part C (20 marks)
  q := pg_temp.add_q(v_bank, c_writ, null, 'extended_text',
$t$Part C. You have five minutes to write this answer.

Write a five-sentence paragraph about ONE of these topics: a mountain, a forest, a river, an important building, a city.

Start by writing your chosen topic, then your paragraph. (20 marks)$t$, 20, 130, 130);
  perform pg_temp.add_rubric(q, 'Part C writing, Form 1 intake (draft bands, please confirm)', c_writ, 20, pg_temp.bands_writing());
  eng1 := eng1 || q;

  -- =========================================================================
  -- English: Form 1 to Form 2  (applicants to Form 2, sort 140)
  -- =========================================================================
  insert into public.passages (bank_id, title, body) values (v_bank,
    'Magazine article: choosing a tree frog as a pet',
$t$Read this magazine article about choices people may consider if they want to select a tree frog as a pet.

When starting with tree frogs, the large and placid White’s tree frog or the iconic red-eyed tree frog are popular choices. However, for something more unusual, consider the American green tree frog, which is hardy and easy to care for. Captive-bred specimens can be found at exotic pet retailers and make charming terrarium subjects.

Native to the sub-tropical climates of the southeastern United States, from North Carolina to Florida and Louisiana, this bold frog prefers ponds, lakes, and flood-plain meadows. Smaller than its European cousin, it averages about 3.75 cm in length when fully grown.

The American green tree frog is vibrant, typically apple green with tiny white or yellow speckles. Its coloration can change, varying from olive green to deep brown depending on its environment.

These frogs are mainly nocturnal, spending the day resting among leaves. They become active in the evenings, calling with their high-pitched, loud voices while inflating their throat pouches.$t$)
  returning id into v_passage;

  -- Part A (10 marks)
  q := pg_temp.add_q(v_bank, c_comp, v_passage, 'extended_text', 'Part A, question 1. What are two popular choices for beginners starting with tree frogs? (2 marks)', 2, 140, 140);
  perform pg_temp.add_rubric(q, 'Form 2 English A1', c_comp, 2, pg_temp.bands2('One of the two: the (large and placid) White''s tree frog; the (iconic) red-eyed tree frog.', 'Both: the White''s tree frog and the red-eyed tree frog.'));
  eng2 := eng2 || q;

  q := pg_temp.add_q(v_bank, c_comp, v_passage, 'extended_text', 'Part A, question 2. What makes the American green tree frog a suitable option for novice keepers? (1 mark)', 1, 140, 140);
  perform pg_temp.add_rubric(q, 'Form 2 English A2', c_comp, 1, pg_temp.bands1('It is hardy and easy to care for.'));
  eng2 := eng2 || q;

  q := pg_temp.add_q(v_bank, c_comp, v_passage, 'extended_text', 'Part A, question 3. Where is the American green tree frog native to, and what types of habitats does it prefer? (2 marks)', 2, 140, 140);
  perform pg_temp.add_rubric(q, 'Form 2 English A3', c_comp, 2, pg_temp.bands2('One of the two: native to the sub-tropical southeastern United States; prefers ponds, lakes and flood-plain meadows.', 'Both: native to the sub-tropical climates of the southeastern United States, and it prefers ponds, lakes and flood-plain meadows.'));
  eng2 := eng2 || q;

  q := pg_temp.add_q(v_bank, c_comp, v_passage, 'extended_text', 'Part A, question 4. How does the size of the American green tree frog compare to its European cousin? (1 mark)', 1, 140, 140);
  perform pg_temp.add_rubric(q, 'Form 2 English A4', c_comp, 1, pg_temp.bands1('It is smaller than its European cousin, averaging about 3.75 cm when fully grown.'));
  eng2 := eng2 || q;

  q := pg_temp.add_q(v_bank, c_comp, v_passage, 'extended_text', 'Part A, question 5. What are the characteristics of the American green tree frog''s behaviour? (1 mark)', 1, 140, 140);
  perform pg_temp.add_rubric(q, 'Form 2 English A5', c_comp, 1, pg_temp.bands1('Mainly nocturnal: it rests among leaves during the day and becomes active in the evenings, calling with high-pitched, loud voices.'));
  eng2 := eng2 || q;

  q := pg_temp.add_q(v_bank, c_read, v_passage, 'extended_text', 'Part A, question 6. Identify an example of personification in the passage. (1 mark)', 1, 140, 140);
  perform pg_temp.add_rubric(q, 'Form 2 English A6', c_read, 1, pg_temp.bands1('The frogs "calling with their high-pitched, loud voices": having a voice and calling are human qualities given to a frog.'));
  eng2 := eng2 || q;

  q := pg_temp.add_q(v_bank, c_read, v_passage, 'extended_text', 'Part A, question 7. Use the following figures of speech to answer: imagery, hyperbole, metaphor.

Find an example of imagery in the passage. (1 mark)', 1, 140, 140);
  perform pg_temp.add_rubric(q, 'Form 2 English A7', c_read, 1, pg_temp.bands1('A phrase that paints a picture, such as "typically apple green with tiny white or yellow speckles".'));
  eng2 := eng2 || q;

  q := pg_temp.add_q(v_bank, c_read, v_passage, 'single_choice', 'Part A, question 8. Use the following figures of speech to answer: imagery, hyperbole, metaphor.

What figure of speech is used in the phrase "the large and placid White''s tree frog or the iconic red-eyed tree frog"? (1 mark)', 1, 140, 140);
  perform pg_temp.add_choice(q, array['imagery', 'hyperbole', 'metaphor'], array[2]);
  eng2 := eng2 || q;

  -- Part B (5 marks)
  q := pg_temp.add_q(v_bank, c_gram, v_passage, 'short_text', 'Part B, question 1. Identify the subject in the sentence: "The American green tree frog is vibrant, typically apple green with tiny white or yellow speckles." (1 mark)', 1, 140, 140);
  perform pg_temp.add_short(q, array['the american green tree frog', 'american green tree frog', 'the american green tree frog is', 'the frog', 'frog', 'tree frog', 'the tree frog', 'green tree frog', 'the green tree frog']);
  eng2 := eng2 || q;

  q := pg_temp.add_q(v_bank, c_gram, v_passage, 'short_text', 'Part B, question 2. What verb tense is used in the sentence "Captive-bred specimens can be found at exotic pet retailers"? (1 mark)', 1, 140, 140);
  perform pg_temp.add_short(q, array['present', 'present tense', 'the present tense', 'simple present', 'present simple', 'simple present tense', 'present simple tense', 'the simple present', 'the present simple', 'present passive', 'present simple passive', 'simple present passive']);
  eng2 := eng2 || q;

  -- Corrected: the supplied key said "gerund"; "tree frogs" is a noun (the gerund in the phrase is "starting").
  q := pg_temp.add_q(v_bank, c_gram, v_passage, 'short_text', 'Part B, question 3. In the phrase "when starting with tree frogs," what part of speech is "tree frogs"? (1 mark)', 1, 140, 140);
  perform pg_temp.add_short(q, array['noun', 'a noun', 'nouns', 'compound noun', 'a compound noun', 'plural noun', 'a plural noun', 'noun (plural)', 'common noun', 'a common noun', 'noun phrase', 'a noun phrase']);
  eng2 := eng2 || q;

  q := pg_temp.add_q(v_bank, c_gram, v_passage, 'extended_text', 'Part B, question 4. Rewrite the sentence "They become active in the evenings, calling with their high-pitched, loud voices" by changing it to the passive voice. (1 mark)', 1, 140, 140);
  perform pg_temp.add_rubric(q, 'Form 2 English B4', c_gram, 1, pg_temp.bands1('A correct passive rewrite, for example: "In the evenings, they are heard calling with their high-pitched, loud voices."'));
  eng2 := eng2 || q;

  q := pg_temp.add_q(v_bank, c_gram, v_passage, 'extended_text', 'Part B, question 5. What type of sentence is "For something more unusual, consider the American green tree frog," and what makes it that type? Choose from: command, question, suggestion, statement. (1 mark)', 1, 140, 140);
  perform pg_temp.add_rubric(q, 'Form 2 English B5', c_gram, 1, pg_temp.bands1('A command (imperative), because it tells or suggests to the reader to consider the frog.'));
  eng2 := eng2 || q;

  -- Part C (20 marks)
  q := pg_temp.add_q(v_bank, c_writ, null, 'extended_text',
$t$Part C. You have five minutes to write this answer.

Write a five-sentence paragraph about owning animals. (20 marks)$t$, 20, 140, 140);
  perform pg_temp.add_rubric(q, 'Part C writing, Form 2 intake (draft bands, please confirm)', c_writ, 20, pg_temp.bands_writing());
  eng2 := eng2 || q;

  -- =========================================================================
  -- English: Form 2 to Form 3  (applicants to Form 3, sort 150)
  -- =========================================================================
  insert into public.passages (bank_id, title, body) values (v_bank,
    'Newspaper article: a cruise on a traditional sailing boat',
$t$Read the following passage carefully, and then answer all the questions.

The following article appeared in the holiday pages of a European newspaper. The writer is recommending to his readers the pleasures of an East African cruise on a traditional sailing boat.

Fishing dhows are still built on Lamu Island, East Africa, using traditional methods that have persisted for centuries. These vessels are crafted from Malabar teak, taking shape slowly without blueprints, relying on the shipwright's skilled eye.

Tusitiri, a 65-foot dhow meaning ‘Something to be Treasured,’ was once based in Mombasa before being refitted for the charter trade. It now sails as far as Mozambique and is known for its comfort, featuring cushions, hand-carved Lamu chairs, and a galley for preparing fresh seafood meals.

During my voyage on Tusitiri, anchored off Shela Village, the evening brought the sight of a large African moon rising over the water. I enjoyed a dinner of fish soup, sweet mangrove crabs, and coconut rice, then slept under the stars.

Yusuf, the skipper, guided us past mangroves and hidden sandbanks using modern navigation tools, while the crew sang songs to the ship, celebrating their cherished vessel as we cruised towards the remote beauty of Kiwayu and the Kiunga Marine National Reserve.$t$)
  returning id into v_passage;

  -- Part A, comprehension (8 marks)
  q := pg_temp.add_q(v_bank, c_comp, v_passage, 'extended_text', 'Part A, question 1. What traditional method is used in the construction of fishing dhows on Lamu Island? (1 mark)', 1, 150, 150);
  perform pg_temp.add_rubric(q, 'Form 3 English A1', c_comp, 1, pg_temp.bands1('They are built without blueprints, relying on the shipwright''s skilled eye (crafted from Malabar teak, taking shape slowly).'));
  eng3 := eng3 || q;

  q := pg_temp.add_q(v_bank, c_comp, v_passage, 'extended_text', 'Part A, question 2. What is the significance of the name "Tusitiri," and what features make it suitable for the charter trade? (2 marks)', 2, 150, 150);
  perform pg_temp.add_rubric(q, 'Form 3 English A2', c_comp, 2, pg_temp.bands2('One of the two: the name means "Something to be Treasured"; it is comfortable, with cushions, hand-carved Lamu chairs and a galley for fresh seafood meals.', 'Both: the name means "Something to be Treasured", and it suits the charter trade because of its comfort: cushions, hand-carved Lamu chairs and a galley for preparing fresh seafood meals.'));
  eng3 := eng3 || q;

  q := pg_temp.add_q(v_bank, c_comp, v_passage, 'extended_text', 'Part A, question 3. Describe the setting during the narrator''s voyage on Tusitiri. (2 marks)', 2, 150, 150);
  perform pg_temp.add_rubric(q, 'Form 3 English A3', c_comp, 2, pg_temp.bands2('Some of the setting: anchored off Shela Village; a large African moon rising over the water; dinner of fish soup, mangrove crabs and coconut rice; sleeping under the stars.', 'A full description: anchored off Shela Village in the evening, a large African moon rising over the water, a dinner of fish soup, sweet mangrove crabs and coconut rice, then sleeping under the stars; a serene atmosphere.'));
  eng3 := eng3 || q;

  q := pg_temp.add_q(v_bank, c_comp, v_passage, 'extended_text', 'Part A, question 4. How did Yusuf, the skipper, navigate during the journey? (1 mark)', 1, 150, 150);
  perform pg_temp.add_rubric(q, 'Form 3 English A4', c_comp, 1, pg_temp.bands1('Using modern navigation tools, guiding the dhow past mangroves and hidden sandbanks.'));
  eng3 := eng3 || q;

  q := pg_temp.add_q(v_bank, c_comp, v_passage, 'extended_text', 'Part A, question 5. What activities did the crew engage in while on the voyage, and what does this suggest about their relationship with the ship? (2 marks)', 2, 150, 150);
  perform pg_temp.add_rubric(q, 'Form 3 English A5', c_comp, 2, pg_temp.bands2('One of the two: the crew sang songs to the ship; this shows they cherish it.', 'Both: the crew sang songs to the ship, celebrating it, which suggests a deep appreciation and strong bond, seeing Tusitiri as more than just a boat.'));
  eng3 := eng3 || q;

  -- Part B, grammar (5 marks)
  q := pg_temp.add_q(v_bank, c_gram, v_passage, 'short_text', 'Part B, question 1. In the sentence "Fishing dhows are still built on Lamu Island," what tense is the verb "are built" in? (1 mark)', 1, 150, 150);
  perform pg_temp.add_short(q, array['present simple', 'simple present', 'present', 'present tense', 'the present tense', 'present simple tense', 'simple present tense', 'the present simple', 'the simple present', 'present simple passive', 'simple present passive', 'present passive', 'present tense passive', 'present tense (passive)', 'present simple (passive)']);
  eng3 := eng3 || q;

  q := pg_temp.add_q(v_bank, c_gram, v_passage, 'single_choice', 'Part B, question 2. Choose the correct form of the verb to fill in the blank: "The crew __________ songs to the ship." (1 mark)', 1, 150, 150);
  perform pg_temp.add_choice(q, array['sing', 'sings', 'singing', 'sung'], array[1]);
  eng3 := eng3 || q;

  -- Corrected: the supplied key said "Fishing dhows"; the sentence follows "Tusitiri, a 65-foot dhow...", so "it" is Tusitiri.
  q := pg_temp.add_q(v_bank, c_gram, v_passage, 'short_text', 'Part B, question 3. In the passage, to what does the pronoun "it" in the sentence "It now sails as far as Mozambique" refer? (1 mark)', 1, 150, 150);
  perform pg_temp.add_short(q, array['tusitiri', 'the dhow', 'the dhow tusitiri', 'tusitiri, the dhow', 'tusitiri the dhow', 'the dhow, tusitiri', 'the 65-foot dhow', 'the 65-foot dhow tusitiri', 'the boat', 'the boat tusitiri', 'the vessel', 'the ship', 'to tusitiri', 'tusitiri (the dhow)', 'the dhow (tusitiri)']);
  eng3 := eng3 || q;

  q := pg_temp.add_q(v_bank, c_gram, v_passage, 'short_text', 'Part B, question 4. Identify the adjective in the phrase "hand-carved Lamu chairs." (1 mark)', 1, 150, 150);
  perform pg_temp.add_short(q, array['hand-carved', 'hand carved', 'handcarved', 'hand-carved lamu', 'lamu']);
  eng3 := eng3 || q;

  q := pg_temp.add_q(v_bank, c_gram, v_passage, 'single_choice', 'Part B, question 5. Sentence structure: which of the following sentences is a complex sentence? (1 mark)', 1, 150, 150);
  perform pg_temp.add_choice(q, array[
    '"Yusuf, the skipper, guided us past mangroves and hidden sandbanks."',
    '"During my voyage on Tusitiri, anchored off Shela Village, the evening brought the sight of a large African moon rising over the water."',
    '"Fishing dhows are still built on Lamu Island."',
    '"This vessel is crafted from Malabar teak."'], array[2]);
  eng3 := eng3 || q;

  -- Part C (20 marks)
  q := pg_temp.add_q(v_bank, c_writ, null, 'extended_text',
$t$Part C. You have five minutes to write this answer.

Write a five-sentence paragraph about a tourist resort that you have visited. (20 marks)$t$, 20, 150, 150);
  perform pg_temp.add_rubric(q, 'Part C writing, Form 3 intake (draft bands, please confirm)', c_writ, 20, pg_temp.bands_writing());
  eng3 := eng3 || q;

  -- =========================================================================
  -- English: Form 3 to Form 4, or currently in Form 4  (applicants to Form 4 or 5, sort 160–170)
  -- =========================================================================
  insert into public.passages (bank_id, title, body) values (v_bank,
    'Extract by George Orwell (1937)',
$t$Read the following extract carefully, and then answer all the questions. In this passage written in 1937, the writer, George Orwell, describes the experience of being wounded when he was a soldier.

The experience of being hit by a bullet is striking and worth describing. It was five o'clock in the morning, a dangerous time with dawn behind us. While speaking to the sentries, I suddenly felt a shock, akin to being at the centre of an explosion. There was a loud bang, a blinding flash, and I felt an immense shock that left me weak and dazed, realizing I had been hit. My knees crumpled, and I fell, hitting the ground, but without pain.

People rushed to help, asking where I was hit, and I discovered my right arm was paralyzed. Oddly, I felt satisfaction, thinking this would please my wife, as she had always wished for me to be wounded to avoid worse fates. After being informed that the bullet went through my throat, I assumed I wouldn’t survive. In those blurry moments, I thought of my wife and felt resentment for leaving this world due to careless fate. I even wondered about the shooter, feeling no animosity towards him.$t$)
  returning id into v_passage;

  -- Part A, comprehension (6 marks)
  q := pg_temp.add_q(v_bank, c_comp, v_passage, 'extended_text', 'Part A, question 1. What time of day is described in the passage, and why is it considered dangerous? (2 marks)', 2, 160, 170);
  perform pg_temp.add_rubric(q, 'Form 4 English A1', c_comp, 2, pg_temp.bands2('One of the two: five o''clock in the morning; dangerous because dawn is behind them.', 'Both: five o''clock in the morning, and it is dangerous because dawn is behind the soldiers, so they would be clearly visible.'));
  eng4 := eng4 || q;

  q := pg_temp.add_q(v_bank, c_comp, v_passage, 'extended_text', 'Part A, question 2. How did the speaker describe the experience of being hit by a bullet? (1 mark)', 1, 160, 170);
  perform pg_temp.add_rubric(q, 'Form 4 English A2', c_comp, 1, pg_temp.bands1('Like being at the centre of an explosion: a loud bang, a blinding flash and an immense shock that left him weak and dazed.'));
  eng4 := eng4 || q;

  q := pg_temp.add_q(v_bank, c_comp, v_passage, 'extended_text', 'Part A, question 3. What physical effect did the bullet have on the speaker''s body? (1 mark)', 1, 160, 170);
  perform pg_temp.add_rubric(q, 'Form 4 English A3', c_comp, 1, pg_temp.bands1('His right arm was paralysed (the bullet went through his throat; his knees crumpled and he fell).'));
  eng4 := eng4 || q;

  q := pg_temp.add_q(v_bank, c_comp, v_passage, 'extended_text', 'Part A, question 4. What thoughts did the speaker have about their wife in the moments following the injury? (1 mark)', 1, 160, 170);
  perform pg_temp.add_rubric(q, 'Form 4 English A4', c_comp, 1, pg_temp.bands1('He felt satisfaction, thinking the wound would please his wife, because she had always wished for him to be wounded to avoid worse fates.'));
  eng4 := eng4 || q;

  q := pg_temp.add_q(v_bank, c_comp, v_passage, 'extended_text', 'Part A, question 5. What emotions did the speaker experience regarding their fate after being shot? (1 mark)', 1, 160, 170);
  perform pg_temp.add_rubric(q, 'Form 4 English A5', c_comp, 1, pg_temp.bands1('Resentment at leaving the world through careless fate, while thinking of his wife and feeling no animosity towards the shooter.'));
  eng4 := eng4 || q;

  -- Part B, grammar and literary skills (8 marks)
  q := pg_temp.add_q(v_bank, c_gram, v_passage, 'short_text', 'Part B, question 1. In the sentence "I suddenly felt a shock, akin to being at the centre of an explosion," what tense is the verb "felt" in? (1 mark)', 1, 160, 170);
  perform pg_temp.add_short(q, array['past simple', 'simple past', 'past', 'past tense', 'the past tense', 'past simple tense', 'simple past tense', 'the past simple', 'the simple past']);
  eng4 := eng4 || q;

  q := pg_temp.add_q(v_bank, c_gram, v_passage, 'single_choice', 'Part B, question 2. Choose the correct form to complete the sentence: "The experience of being hit by a bullet __________ striking and worth describing." (1 mark)', 1, 160, 170);
  perform pg_temp.add_choice(q, array['are', 'is', 'were', 'be'], array[2]);
  eng4 := eng4 || q;

  q := pg_temp.add_q(v_bank, c_gram, v_passage, 'short_text', 'Part B, question 3. In the passage, to whom does the pronoun "him" in the phrase "I even wondered about the shooter, feeling no animosity towards him" refer? (1 mark)', 1, 160, 170);
  perform pg_temp.add_short(q, array['the shooter', 'shooter', 'to the shooter', 'the person who shot him', 'the man who shot him', 'the soldier who shot him', 'the one who shot him']);
  eng4 := eng4 || q;

  q := pg_temp.add_q(v_bank, c_read, v_passage, 'extended_text', 'Part B, question 4. In the sentence "I suddenly felt a shock, akin to being at the centre of an explosion," what literary device is used, and what does it compare the shock to? (1 mark)', 1, 160, 170);
  perform pg_temp.add_rubric(q, 'Form 4 English B4', c_read, 1, pg_temp.bands1('A simile, comparing the shock to being at the centre of an explosion (using "akin to").'));
  eng4 := eng4 || q;

  q := pg_temp.add_q(v_bank, c_read, v_passage, 'extended_text', 'Part B, question 5. What type of imagery is present in the phrase "a loud bang, a blinding flash," and how does it contribute to the reader''s understanding of the experience? (2 marks)', 2, 160, 170);
  perform pg_temp.add_rubric(q, 'Form 4 English B5', c_read, 2, pg_temp.bands2('One of the two: names the imagery as auditory (loud bang) and/or visual (blinding flash); or explains that it makes the moment vivid and overwhelming.', 'Both: auditory (loud bang) and visual (blinding flash) imagery, which creates a vivid picture and conveys how overwhelming and intense the moment was.'));
  eng4 := eng4 || q;

  q := pg_temp.add_q(v_bank, c_read, v_passage, 'extended_text', 'Part B, question 6. In the phrase "I fell, hitting the ground, but without pain," how is the concept of "the ground" personified, and what effect does it produce? (2 marks)', 2, 160, 170);
  perform pg_temp.add_rubric(q, 'Form 4 English B6', c_read, 2, pg_temp.bands2('One of the two: the ground is treated as something that could cause or withhold pain; or the effect of shock and disconnection is explained.', 'Both: the ground is given the ability to cause or not cause pain, an almost indifferent relationship, which highlights the speaker''s shock and disconnection from his body and surroundings.'));
  eng4 := eng4 || q;

  -- Part C (20 marks)
  q := pg_temp.add_q(v_bank, c_writ, null, 'extended_text',
$t$Part C. Describe, in a six-sentence paragraph, an experience you had in which you were either (a) very scared or (b) very excited. (20 marks)$t$, 20, 160, 170);
  perform pg_temp.add_rubric(q, 'Part C writing, Form 4 intake (draft bands, please confirm)', c_writ, 20, pg_temp.bands_writing());
  eng4 := eng4 || q;

  -- =========================================================================
  -- Mathematics: Form 1 entrance test (sort 130)
  -- =========================================================================
  q := pg_temp.add_q(v_bank, c_geom, null, 'single_choice', '1. A triangle with all equal sides is called', 1, 130, 130);
  perform pg_temp.add_choice(q, array['Scalene', 'Isosceles', 'Equilateral', 'Kite'], array[3]); mat1 := mat1 || q;
  q := pg_temp.add_q(v_bank, c_geom, null, 'single_choice', '2. Angles in a triangle add up to', 1, 130, 130);
  perform pg_temp.add_choice(q, array['90 degrees', '180 degrees', '270 degrees', '360 degrees'], array[2]); mat1 := mat1 || q;
  q := pg_temp.add_q(v_bank, c_num, null, 'single_choice', '3. Which of the following is an even number?', 1, 130, 130);
  perform pg_temp.add_choice(q, array['1', '2', '9', '37'], array[2]); mat1 := mat1 || q;
  q := pg_temp.add_q(v_bank, c_num, null, 'single_choice', '4. Which of the following is a factor of 12?', 1, 130, 130);
  perform pg_temp.add_choice(q, array['7', '11', '24', '3'], array[4]); mat1 := mat1 || q;
  -- Q5 offers two correct options (19 and 37 are both prime). Draft, not in the sitting, until the school picks one.
  -- Corrected: the paper offered 19 and 37, both prime; 37 replaced by 27.
  q := pg_temp.add_q(v_bank, c_num, null, 'single_choice', '5. Which of the following is a prime number?', 1, 130, 130);
  perform pg_temp.add_choice(q, array['1', '9', '19', '27'], array[3]); mat1 := mat1 || q;
  q := pg_temp.add_q(v_bank, c_num, null, 'single_choice', '6. Which of the following is a square number?', 1, 130, 130);
  perform pg_temp.add_choice(q, array['4', '15', '3', '11'], array[1]); mat1 := mat1 || q;
  -- Q7 has no correct option on the paper (½ base × height is the area of a triangle; the options are kite, circle, rectangle, square). Draft, not in the sitting.
  -- Corrected: the paper offered kite, circle, rectangle, square; "kite" replaced by "triangle".
  q := pg_temp.add_q(v_bank, c_geom, null, 'single_choice', '7. The formula ½ base × height is used to find the area of', 1, 130, 130);
  perform pg_temp.add_choice(q, array['triangle', 'circle', 'rectangle', 'square'], array[1]); mat1 := mat1 || q;
  q := pg_temp.add_q(v_bank, c_patt, null, 'single_choice', '8. a + a + a + a is equal to', 1, 130, 130);
  perform pg_temp.add_choice(q, array['a × a × a', '4a', '4 − a', 'a⁴'], array[2]); mat1 := mat1 || q;
  q := pg_temp.add_q(v_bank, c_geom, null, 'single_choice', '9. Any shape with 4 sides is called a', 1, 130, 130);
  perform pg_temp.add_choice(q, array['Pentagon', 'Square', 'Triangle', 'Quadrilateral'], array[4]); mat1 := mat1 || q;
  q := pg_temp.add_q(v_bank, c_arith, null, 'single_choice', '10. The product of 3 and 5 is', 1, 130, 130);
  perform pg_temp.add_choice(q, array['8', '2', '15', '⅗'], array[3]); mat1 := mat1 || q;
  -- Section B (2 marks each)
  q := pg_temp.add_q(v_bank, c_arith, null, 'numeric', 'Section B, question 1. Find 25% of 300 pula. Type the number only. (2 marks)', 2, 130, 130);
  perform pg_temp.add_num(q, 75); mat1 := mat1 || q;
  q := pg_temp.add_q(v_bank, c_num, null, 'extended_text', 'Section B, question 2. Convert 26/4 to a mixed fraction. (2 marks)', 2, 130, 130);
  perform pg_temp.add_rubric(q, 'Form 1 Maths B2', c_num, 2, pg_temp.bands2('Partly right, for example 6 2/4 not simplified, or the right whole number with a wrong fraction.', 'Correct: 6½ (6 and a half; 6 2/4 simplified to 6 1/2).')); mat1 := mat1 || q;
  q := pg_temp.add_q(v_bank, c_num, null, 'extended_text', 'Section B, question 3. Express 12 as a product of its prime factors. (2 marks)', 2, 130, 130);
  perform pg_temp.add_rubric(q, 'Form 1 Maths B3', c_num, 2, pg_temp.bands2('Partly right: some prime factors found, for example 2 × 6 or 3 × 4.', 'Correct: 2 × 2 × 3 (or 2² × 3).')); mat1 := mat1 || q;
  q := pg_temp.add_q(v_bank, c_arith, null, 'numeric', 'Section B, question 4. 3948 + 7938. Type the number only. (2 marks)', 2, 130, 130);
  perform pg_temp.add_num(q, 11886); mat1 := mat1 || q;
  q := pg_temp.add_q(v_bank, c_patt, null, 'extended_text', 'Section B, question 5. Write the next 2 terms in this sequence: 4, 7, 10, 13, ……, …… (2 marks)', 2, 130, 130);
  perform pg_temp.add_rubric(q, 'Form 1 Maths B5', c_patt, 2, pg_temp.bands2('One of the two terms right (16 or 19), or the rule "add 3" shown.', 'Both terms: 16 and 19.')); mat1 := mat1 || q;

  -- =========================================================================
  -- Mathematics: Form 2 entrance test (sort 140)
  -- =========================================================================
  q := pg_temp.add_q(v_bank, c_num, null, 'single_choice', '1. What is the value of 3 in the number 201.305?', 1, 140, 140);
  perform pg_temp.add_choice(q, array['Hundreds', 'Tens', 'Units', 'Tenths'], array[4]); mat2 := mat2 || q;
  q := pg_temp.add_q(v_bank, c_num, null, 'single_choice', '2. Which is the first significant figure in the number 0.00348?', 1, 140, 140);
  perform pg_temp.add_choice(q, array['0', '3', '4', '8'], array[2]); mat2 := mat2 || q;
  q := pg_temp.add_q(v_bank, c_num, null, 'single_choice', '3. Round off 164.56 to the nearest 10', 1, 140, 140);
  perform pg_temp.add_choice(q, array['164', '160', '165', '164.6'], array[2]); mat2 := mat2 || q;
  q := pg_temp.add_q(v_bank, c_arith, null, 'single_choice', '4. The value of 13² is', 1, 140, 140);
  perform pg_temp.add_choice(q, array['26', '46', '169', '149'], array[3]); mat2 := mat2 || q;
  q := pg_temp.add_q(v_bank, c_arith, null, 'single_choice', '5. The value of √144 is', 1, 140, 140);
  perform pg_temp.add_choice(q, array['44', '12', '14', '16'], array[2]); mat2 := mat2 || q;
  q := pg_temp.add_q(v_bank, c_num, null, 'single_choice', '6. The following is an example of an odd square number', 1, 140, 140);
  perform pg_temp.add_choice(q, array['4', '9', '27', '16'], array[2]); mat2 := mat2 || q;
  q := pg_temp.add_q(v_bank, c_geom, null, 'single_choice', '7. The sum of angles in a right-angled triangle is', 1, 140, 140);
  perform pg_temp.add_choice(q, array['90 degrees', '360 degrees', '270 degrees', '180 degrees'], array[4]); mat2 := mat2 || q;
  q := pg_temp.add_q(v_bank, c_patt, null, 'single_choice', '8. The value of 2a² × 3 is', 1, 140, 140);
  perform pg_temp.add_choice(q, array['5a²', '6a', '6a²', '23a²'], array[3]); mat2 := mat2 || q;
  q := pg_temp.add_q(v_bank, c_patt, null, 'single_choice', '9. a × a × a =', 1, 140, 140);
  perform pg_temp.add_choice(q, array['3a', 'a³', '3a³', 'a'], array[2]); mat2 := mat2 || q;
  q := pg_temp.add_q(v_bank, c_num, null, 'single_choice', '10. The value of 10⁰ is', 1, 140, 140);
  perform pg_temp.add_choice(q, array['100', '10', '0', '1'], array[4]); mat2 := mat2 || q;
  -- Section B (2 marks each)
  q := pg_temp.add_q(v_bank, c_patt, null, 'extended_text', 'Section B, question 1. Simplify: 2a + 3b + 3a − 2b = (2 marks)', 2, 140, 140);
  perform pg_temp.add_rubric(q, 'Form 2 Maths B1', c_patt, 2, pg_temp.bands2('One of the two terms right (5a or b).', 'Correct: 5a + b.')); mat2 := mat2 || q;
  q := pg_temp.add_q(v_bank, c_patt, null, 'numeric', 'Section B, question 2. Evaluate a² − b² when a = 4 and b = 3. Type the number only. (2 marks)', 2, 140, 140);
  perform pg_temp.add_num(q, 7); mat2 := mat2 || q;
  q := pg_temp.add_q(v_bank, c_patt, null, 'extended_text', 'Section B, question 3. Simplify: ab + ba = (2 marks)', 2, 140, 140);
  perform pg_temp.add_rubric(q, 'Form 2 Maths B3', c_patt, 2, pg_temp.bands2('Shows that ab and ba are the same term but does not finish (for example ab + ab).', 'Correct: 2ab.')); mat2 := mat2 || q;
  q := pg_temp.add_q(v_bank, c_patt, null, 'numeric', 'Section B, question 4. Find x if 3x = 12. Type the number only. (2 marks)', 2, 140, 140);
  perform pg_temp.add_num(q, 4); mat2 := mat2 || q;
  q := pg_temp.add_q(v_bank, c_prob, null, 'numeric', 'Section B, question 5. Change 2 m² to cm². Type the number only. (2 marks)', 2, 140, 140);
  perform pg_temp.add_num(q, 20000); mat2 := mat2 || q;

  -- =========================================================================
  -- Mathematics: Form 3 entrance test (sort 150)
  -- =========================================================================
  q := pg_temp.add_q(v_bank, c_prob, null, 'single_choice', '1. How many mm are there in 1 m 1 cm?', 1, 150, 150);
  perform pg_temp.add_choice(q, array['100', '1110', '1010', '1100'], array[3]); mat3 := mat3 || q;
  q := pg_temp.add_q(v_bank, c_geom, null, 'single_choice', '2. The longest side in a right-angled triangle is called', 1, 150, 150);
  perform pg_temp.add_choice(q, array['adjacent side', 'opposite side', 'the hypotenuse', 'chord'], array[3]); mat3 := mat3 || q;
  q := pg_temp.add_q(v_bank, c_patt, null, 'single_choice', '3. Find the value of n if 5/n = 2.5', 1, 150, 150);
  perform pg_temp.add_choice(q, array['1', '2', '−2', '0.2'], array[2]); mat3 := mat3 || q;
  q := pg_temp.add_q(v_bank, c_patt, null, 'single_choice', '4. If 5x − 2 = 3x + 8 then x =', 1, 150, 150);
  perform pg_temp.add_choice(q, array['10', '5', '−5', '3'], array[2]); mat3 := mat3 || q;
  q := pg_temp.add_q(v_bank, c_num, null, 'single_choice', '5. How many prime numbers are there between 30 and 40?', 1, 150, 150);
  perform pg_temp.add_choice(q, array['0', '1', '2', '3'], array[3]); mat3 := mat3 || q;
  q := pg_temp.add_q(v_bank, c_num, null, 'single_choice', '6. If 5ˣ = 120, the best approximate solution is x =', 1, 150, 150);
  perform pg_temp.add_choice(q, array['2', '3', '4', '25'], array[2]); mat3 := mat3 || q;
  q := pg_temp.add_q(v_bank, c_arith, null, 'single_choice', '7. 800 decreased by 5% is', 1, 150, 150);
  perform pg_temp.add_choice(q, array['795', '540', '760', '400'], array[3]); mat3 := mat3 || q;
  q := pg_temp.add_q(v_bank, c_geom, null, 'single_choice', '8. The perimeter of a square is 36 cm. What is its area?', 1, 150, 150);
  perform pg_temp.add_choice(q, array['36 cm²', '324 cm²', '81 cm²', '9 cm²'], array[3]); mat3 := mat3 || q;
  q := pg_temp.add_q(v_bank, c_geom, null, 'single_choice', '9. The line dividing a circle into 2 equal halves is called a', 1, 150, 150);
  perform pg_temp.add_choice(q, array['radius', 'tangent', 'diameter', 'chord'], array[3]); mat3 := mat3 || q;
  q := pg_temp.add_q(v_bank, c_prob, null, 'single_choice', '10. If 600 pula is shared in the ratio 1:4, the smallest share will be', 1, 150, 150);
  perform pg_temp.add_choice(q, array['150', '120', '200', '1 200'], array[2]); mat3 := mat3 || q;
  -- Section B (2 marks each)
  q := pg_temp.add_q(v_bank, c_prob, null, 'numeric', 'Section B, question 1. What is the new fare when the old fare of 250 is increased by 8%? Type the number only. (2 marks)', 2, 150, 150);
  perform pg_temp.add_num(q, 270); mat3 := mat3 || q;
  q := pg_temp.add_q(v_bank, c_patt, null, 'numeric', 'Section B, question 2. Evaluate a² + b² when a = 4 and b = −3. Type the number only. (2 marks)', 2, 150, 150);
  perform pg_temp.add_num(q, 25); mat3 := mat3 || q;
  q := pg_temp.add_q(v_bank, c_patt, null, 'extended_text', 'Section B, question 3. Expand 2a(4 − a). (2 marks)', 2, 150, 150);
  perform pg_temp.add_rubric(q, 'Form 3 Maths B3', c_patt, 2, pg_temp.bands2('One term right (8a or −2a²), or a sign error.', 'Correct: 8a − 2a².')); mat3 := mat3 || q;
  q := pg_temp.add_q(v_bank, c_num, null, 'numeric', 'Section B, question 4. Find the cube root of 64 × 27. Type the number only. (2 marks)', 2, 150, 150);
  perform pg_temp.add_num(q, 12); mat3 := mat3 || q;
  q := pg_temp.add_q(v_bank, c_prob, null, 'extended_text', 'Section B, question 5. Find the median and the mode of these 5 numbers: 5, 2, 11, 2, 8 (2 marks)', 2, 150, 150);
  perform pg_temp.add_rubric(q, 'Form 3 Maths B5', c_prob, 2, pg_temp.bands2('One of the two right: median 5, or mode 2.', 'Both: median 5 and mode 2.')); mat3 := mat3 || q;

  -- =========================================================================
  -- Mathematics: Form 4 entrance test (applicants to Form 4 or 5, sort 160–170)
  -- =========================================================================
  -- Q1 has no correct option on the paper (the gradient of y = 3x − 3 is 3; the options are −3, 2, y, x). Draft, not in the sitting.
  -- Corrected: the paper offered −3, 2, y, x; "2" replaced by "3".
  q := pg_temp.add_q(v_bank, c_patt, null, 'single_choice', '1. The gradient of the line y = 3x − 3 is', 1, 160, 170);
  perform pg_temp.add_choice(q, array['−3', '3', 'y', 'x'], array[2]); mat4 := mat4 || q;
  q := pg_temp.add_q(v_bank, c_prob, null, 'single_choice', '2. A school employs 1 200 people of whom 240 are men. The percentage of employees who are men is', 1, 160, 170);
  perform pg_temp.add_choice(q, array['40%', '10%', '15%', '20%'], array[4]); mat4 := mat4 || q;
  q := pg_temp.add_q(v_bank, c_geom, null, 'single_choice', '3. The 3 angles in a triangle are 2x, 3x and x. The largest angle is', 1, 160, 170);
  perform pg_temp.add_choice(q, array['30 degrees', '90 degrees', '120 degrees', '80 degrees'], array[2]); mat4 := mat4 || q;
  q := pg_temp.add_q(v_bank, c_num, null, 'single_choice', '4. Given that a = ⅗, b = ⅓ and c = ½, then', 1, 160, 170);
  perform pg_temp.add_choice(q, array['a > b > c', 'a > c > b', 'a < b < c', 'a < c < b'], array[2]); mat4 := mat4 || q;
  q := pg_temp.add_q(v_bank, c_geom, null, 'single_choice', '5. The larger angle between south-west and east is', 1, 160, 170);
  perform pg_temp.add_choice(q, array['225 degrees', '240 degrees', '135 degrees', '316 degrees'], array[1]); mat4 := mat4 || q;
  q := pg_temp.add_q(v_bank, c_geom, null, 'single_choice', '6. Each exterior angle of a regular polygon with n sides is 10°. n =', 1, 160, 170);
  perform pg_temp.add_choice(q, array['9', '18', '30', '36'], array[4]); mat4 := mat4 || q;
  -- Q7 has no correct option on the paper (1 − 0.05 = 0.95 = 19/20; the options are 1/20, 9/10, 10/20, 5/100). Draft, not in the sitting.
  -- Corrected: the paper offered 1/20, 9/10, 10/20, 5/100; "10/20" replaced by "19/20".
  q := pg_temp.add_q(v_bank, c_num, null, 'single_choice', '7. What is the value of 1 − 0.05 as a fraction?', 1, 160, 170);
  perform pg_temp.add_choice(q, array['1/20', '9/10', '19/20', '5/100'], array[3]); mat4 := mat4 || q;
  q := pg_temp.add_q(v_bank, c_patt, null, 'single_choice', '8. What is the value of the expression (x − 2)(x + 4) when x = −1?', 1, 160, 170);
  perform pg_temp.add_choice(q, array['−9', '9', '−5', '5'], array[1]); mat4 := mat4 || q;
  q := pg_temp.add_q(v_bank, c_prob, null, 'single_choice', '9. A school has 400 students of whom 250 are boys. The ratio of boys to girls is', 1, 160, 170);
  perform pg_temp.add_choice(q, array['5:3', '3:2', '3:5', '8:5'], array[1]); mat4 := mat4 || q;
  q := pg_temp.add_q(v_bank, c_num, null, 'single_choice', '10. The approximate value of 9.65 × 0.203 divided by 0.0198 is', 1, 160, 170);
  perform pg_temp.add_choice(q, array['100', '10', '1', '180'], array[1]); mat4 := mat4 || q;
  -- Section B (2 marks each)
  q := pg_temp.add_q(v_bank, c_prob, null, 'extended_text', 'Section B, question 1. The price of a television changed from $340 to $300. Calculate the percentage change. (2 marks)', 2, 160, 170);
  -- Corrected: the paper said "increase" from $340 to $300, which is a decrease; asked as "percentage change".
  perform pg_temp.add_rubric(q, 'Form 4 Maths B1', c_prob, 2, pg_temp.bands2('Method shown (40 ÷ 340 × 100) with an arithmetic slip, or 40 found but not turned into a percentage.', 'Correct: a decrease of about 11.8% (40 ÷ 340 × 100 = 11.76%).')); mat4 := mat4 || q;
  q := pg_temp.add_q(v_bank, c_geom, null, 'numeric', 'Section B, question 2. The bearing of A from B is 120°. Calculate the bearing of B from A. Type the number only. (2 marks)', 2, 160, 170);
  perform pg_temp.add_num(q, 300); mat4 := mat4 || q;
  q := pg_temp.add_q(v_bank, c_patt, null, 'numeric', 'Section B, question 3. Numbers m, x and y satisfy the equation y = mx². When m = ½ and x = 4, find the value of y. Type the number only. (2 marks)', 2, 160, 170);
  perform pg_temp.add_num(q, 8); mat4 := mat4 || q;
  q := pg_temp.add_q(v_bank, c_prob, null, 'numeric', 'Section B, question 4. Joy invested 8 000 pula at a rate of 5% simple interest for 6 years. Calculate the interest earned during that period. Type the number only. (2 marks)', 2, 160, 170);
  perform pg_temp.add_num(q, 2400); mat4 := mat4 || q;
  q := pg_temp.add_q(v_bank, c_prob, null, 'numeric', 'Section B, question 5. A straight line is 4.5 cm long. Calculate ⅔ of this line, in cm. Type the number only. (2 marks)', 2, 160, 170);
  perform pg_temp.add_num(q, 3); mat4 := mat4 || q;

  -- =========================================================================
  -- Templates: one per intake year, English then Mathematics, 20 minutes each
  -- =========================================================================
  insert into public.assessment_templates (name, description, grade_sort_min, grade_sort_max, time_limit_minutes, status)
  values ('Form 1 intake test (2026)', 'English (Stage 6/7 to Form 1) and Mathematics (Form 1 entrance) papers, 20 minutes each.', 130, 130, 40, 'active')
  returning id into v_template;
  perform pg_temp.add_section(v_template, 1, 'English', s_english, eng_instructions, 20, eng1);
  perform pg_temp.add_section(v_template, 2, 'Mathematics', s_maths, maths_instructions, 20, mat1);

  insert into public.assessment_templates (name, description, grade_sort_min, grade_sort_max, time_limit_minutes, status)
  values ('Form 2 intake test (2026)', 'English (Form 1 to Form 2) and Mathematics (Form 2 entrance) papers, 20 minutes each.', 140, 140, 40, 'active')
  returning id into v_template;
  perform pg_temp.add_section(v_template, 1, 'English', s_english, eng_instructions, 20, eng2);
  perform pg_temp.add_section(v_template, 2, 'Mathematics', s_maths, maths_instructions, 20, mat2);

  insert into public.assessment_templates (name, description, grade_sort_min, grade_sort_max, time_limit_minutes, status)
  values ('Form 3 intake test (2026)', 'English (Form 2 to Form 3) and Mathematics (Form 3 entrance) papers, 20 minutes each.', 150, 150, 40, 'active')
  returning id into v_template;
  perform pg_temp.add_section(v_template, 1, 'English', s_english, eng_instructions, 20, eng3);
  perform pg_temp.add_section(v_template, 2, 'Mathematics', s_maths, maths_instructions, 20, mat3);

  insert into public.assessment_templates (name, description, grade_sort_min, grade_sort_max, time_limit_minutes, status)
  values ('Form 4 and Form 5 intake test (2026)', 'English (Form 3 to Form 4, or currently in Form 4) and Mathematics (Form 4 entrance) papers, 20 minutes each. Used for Form 5 applicants too until the school supplies a Form 5 paper.', 160, 170, 40, 'active')
  returning id into v_template;
  perform pg_temp.add_section(v_template, 1, 'English', s_english, eng_instructions, 20, eng4);
  perform pg_temp.add_section(v_template, 2, 'Mathematics', s_maths, maths_instructions, 20, mat4);

  raise notice 'secondary_intake_2026: bank, % English + % Mathematics questions in sittings, four templates created.',
    array_length(eng1, 1) + array_length(eng2, 1) + array_length(eng3, 1) + array_length(eng4, 1),
    array_length(mat1, 1) + array_length(mat2, 1) + array_length(mat3, 1) + array_length(mat4, 1);
end
$$;
