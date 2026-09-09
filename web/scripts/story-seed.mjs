#!/usr/bin/env node
// Prints the SQL that seeds the story assessments (Tumi's Journey) from
// web/content/story/*.json. Idempotent: every row's id is derived from its
// code, and every write is an upsert, so the script can be re-run after a
// chapter is edited without duplicating anything or touching forms that
// were already sat (forms snapshot questions at launch).
//
//   node web/scripts/story-seed.mjs > /tmp/story-seed.sql
//   psql "$DATABASE_URL" -f /tmp/story-seed.sql
//
// Each chapter becomes one DO block carrying its JSON, so the output stays
// close to the size of the content and can be pasted into a SQL console.
// Nothing here is a secret and nothing here decides an admission: it is
// content, the same content a staff member could type into the editor.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "..", "content", "story");
const chapters = readdirSync(contentDir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(contentDir, f), "utf8")))
  .sort((a, b) => a.grade_sort - b.grade_sort);

// Validate before printing anything, so a bad chapter fails loudly.
const claimed = new Map();
for (const chapter of chapters) {
  if ((chapter.status ?? "active") === "active") {
    const already = claimed.get(chapter.grade_sort);
    if (already) {
      throw new Error(
        `${chapter.code} and ${already} both claim grade ${chapter.grade_sort}. Only one chapter can be active per grade, or the launcher has to guess.`
      );
    }
    claimed.set(chapter.grade_sort, chapter.code);
  }
  for (const scene of chapter.scenes) {
    for (const item of scene.items) {
      const options = item.options ?? [];
      if (item.type === "single_choice" && !options.includes(item.key?.correct)) {
        throw new Error(`${item.code}: correct option "${item.key?.correct}" is not among its options`);
      }
      if (item.type === "ordering" && options.length < 2) throw new Error(`${item.code}: ordering needs at least two options`);
      if (!["adult_marked", "single_choice", "numeric", "short_text", "ordering"].includes(item.type)) {
        throw new Error(`${item.code}: unsupported type ${item.type}`);
      }
    }
  }
}

const BLOCK = String.raw`
do $seed$
declare
  ch jsonb := $json$__JSON__$json$::jsonb;
  v_code text;
  v_bank uuid;
  v_tmpl uuid;
  v_sec uuid;
  v_q uuid;
  v_comp uuid;
  v_subj uuid;
  v_grade int;
  sc jsonb;
  it jsonb;
  si int := 0;
  qi int;
  oi int;
  opt text;
  v_answer jsonb;
  v_correct int;
begin
  v_code := ch->>'code';
  v_grade := (ch->>'grade_sort')::int;
  v_bank := md5('story:bank:' || v_code)::uuid;
  v_tmpl := md5('story:template:' || v_code)::uuid;

  insert into public.question_banks (id, name, description, status)
  values (v_bank, ch->>'name', 'Story assessment items. Seeded from web/content/story; edit there and re-run the seed.', 'active')
  on conflict (id) do update set name = excluded.name, description = excluded.description, status = 'active';

  insert into public.assessment_templates (id, name, description, grade_sort_min, grade_sort_max, time_limit_minutes, status, delivery, story_character)
  values (v_tmpl, ch->>'name', 'A read-aloud story assessment. An adult sits with the child and marks alongside.',
          v_grade, v_grade, (ch->>'time_limit_minutes')::int, coalesce(ch->>'status', 'active'), 'story', ch->>'character')
  on conflict (id) do update set name = excluded.name, description = excluded.description, grade_sort_min = excluded.grade_sort_min,
    grade_sort_max = excluded.grade_sort_max, time_limit_minutes = excluded.time_limit_minutes, delivery = 'story',
    story_character = excluded.story_character, status = coalesce(ch->>'status', 'active');

  delete from public.template_sections where template_id = v_tmpl and position > jsonb_array_length(ch->'scenes');

  for sc in select * from jsonb_array_elements(ch->'scenes') loop
    si := si + 1;
    v_sec := md5('story:section:' || v_code || ':' || (sc->>'key'))::uuid;
    select id into v_subj from public.subjects where code = sc->>'subject';
    if v_subj is null then raise exception 'unknown subject %', sc->>'subject'; end if;

    -- Positions are unique per template: park every section high, renumber at the end.
    insert into public.template_sections (id, template_id, position, title, subject_id, instructions, selection, scene_key, narration, stop_after_misses)
    values (v_sec, v_tmpl, 1000 + si, sc->>'title', v_subj, sc->>'sees', 'fixed', sc->>'key', sc->>'narration', (ch->>'stop_after_misses')::int)
    on conflict (id) do update set template_id = excluded.template_id, position = excluded.position, title = excluded.title,
      subject_id = excluded.subject_id, instructions = excluded.instructions, selection = 'fixed', scene_key = excluded.scene_key,
      narration = excluded.narration, stop_after_misses = excluded.stop_after_misses;

    delete from public.template_section_questions where section_id = v_sec;

    qi := 0;
    for it in select * from jsonb_array_elements(sc->'items') loop
      qi := qi + 1;
      v_q := md5('story:q:' || (it->>'code'))::uuid;
      select id into v_comp from public.competencies where code = it->>'competency';
      if v_comp is null then raise exception 'unknown competency %', it->>'competency'; end if;

      insert into public.questions (id, bank_id, competency_id, type, stem, marks, difficulty, grade_sort_min, grade_sort_max, status,
                                    external_code, narration, answer_mode, scene_focus, adult_note)
      values (v_q, v_bank, v_comp, it->>'type', it->>'narration', (it->>'marks')::numeric, (it->>'difficulty')::int, v_grade, v_grade, 'active',
              it->>'code', it->>'narration', it->>'mode',
              coalesce(array(select jsonb_array_elements_text(it->'focus')), '{}'::text[]), it->>'note')
      on conflict (id) do update set bank_id = excluded.bank_id, competency_id = excluded.competency_id, type = excluded.type,
        stem = excluded.stem, marks = excluded.marks, difficulty = excluded.difficulty, grade_sort_min = excluded.grade_sort_min,
        grade_sort_max = excluded.grade_sort_max, status = 'active', external_code = excluded.external_code,
        narration = excluded.narration, answer_mode = excluded.answer_mode, scene_focus = excluded.scene_focus, adult_note = excluded.adult_note;

      -- Options are replaced wholesale; ids stay stable per (question, position).
      if it ? 'options' and jsonb_array_length(it->'options') > 0 then
        delete from public.question_options where question_id = v_q and position > jsonb_array_length(it->'options');
        oi := 0;
        for opt in select * from jsonb_array_elements_text(it->'options') loop
          oi := oi + 1;
          insert into public.question_options (id, question_id, position, label)
          values (md5('story:o:' || (it->>'code') || ':' || oi)::uuid, v_q, oi, opt)
          on conflict (id) do update set label = excluded.label, position = excluded.position;
        end loop;
      else
        delete from public.question_options where question_id = v_q;
      end if;

      case it->>'type'
        when 'adult_marked' then
          v_answer := jsonb_build_object('expected', it->'key'->>'expected');
        when 'single_choice' then
          select ord - 1 into v_correct
          from jsonb_array_elements_text(it->'options') with ordinality as o(label, ord)
          where o.label = it->'key'->>'correct';
          v_answer := jsonb_build_object('option_ids', jsonb_build_array(md5('story:o:' || (it->>'code') || ':' || (v_correct + 1))::uuid));
        when 'numeric' then
          v_answer := jsonb_build_object('value', (it->'key'->>'value')::numeric, 'tolerance', coalesce((it->'key'->>'tolerance')::numeric, 0));
        when 'short_text' then
          v_answer := jsonb_build_object('accepted', it->'key'->'accepted');
        when 'ordering' then
          select jsonb_build_object('order', jsonb_agg(md5('story:o:' || (it->>'code') || ':' || ord)::uuid order by ord)) into v_answer
          from jsonb_array_elements_text(it->'options') with ordinality as o(label, ord);
      end case;

      insert into public.question_answers (question_id, answer) values (v_q, v_answer)
      on conflict (question_id) do update set answer = excluded.answer;

      insert into public.template_section_questions (section_id, question_id, position) values (v_sec, v_q, qi);
    end loop;
  end loop;

  update public.template_sections set position = position - 1000 where template_id = v_tmpl and position > 1000;
end $seed$;
`;

const out = ["-- Generated by web/scripts/story-seed.mjs. Do not edit; edit the JSON and re-run.", "begin;"];
for (const chapter of chapters) {
  const json = JSON.stringify(chapter);
  if (json.includes("$json$")) throw new Error(`${chapter.code}: content may not contain the delimiter $json$`);
  out.push(`-- ${chapter.name}`);
  out.push(BLOCK.replace("__JSON__", json));
}
out.push("commit;");
process.stdout.write(out.join("\n") + "\n");
