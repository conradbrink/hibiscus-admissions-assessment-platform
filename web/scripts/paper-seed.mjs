#!/usr/bin/env node
// Prints the SQL that seeds the Cambridge Progression papers from
// web/content/papers/*.json: one bank, passages and questions per paper, a
// writing rubric per stage, and one 40-minute template per entry stage made
// of three timed parts (English 15 min, Mathematics 13, Science 12). The
// whole paper goes into the bank; the template holds a selection that fits
// the time, spread through the paper so every strand and difficulty is
// touched, which staff can change in the template editor. Idempotent like
// the story seed: ids derive from codes, every write is an upsert, sat
// forms are untouched.
//
//   node web/scripts/paper-seed.mjs > /tmp/paper-seed.sql
//   psql "$DATABASE_URL" -f /tmp/paper-seed.sql

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "content", "papers");
const papers = readdirSync(dir)
  .filter((f) => /^s\d-[a-z]+\.json$/.test(f))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));

/** Which entry grades sit which paper stage, on grades.sort_order. */
const ENTRY = { 4: { min: 90, max: 90, label: "Stage 4" }, 5: { min: 100, max: 100, label: "Stage 5" }, 6: { min: 110, max: 120, label: "Stage 6 and Stage 7" } };
const SUBJECT_ORDER = ["english", "mathematics", "science"];
/** Minutes per part; the whole sitting is 40. */
const BUDGET = { english: 15, mathematics: 13, science: 12 };
/** Minutes the short writing piece gets inside the English part. */
const SHORT_WRITING_MINUTES = 5;
/** Minutes to read the insert once before the reading questions. */
const PASSAGE_MINUTES = 3;

/** How long a child needs for one item: a rough, deliberately generous estimate. */
function minutesFor(it) {
  const base = { single_choice: 0.5, multi_select: 0.8, numeric: 0.7, short_text: 0.8, matching: 1.2, ordering: 1.0, extended_text: 30 }[it.type] ?? 0.8;
  return base + 0.25 * Math.max(0, (it.marks ?? 1) - 1);
}

/**
 * The items of one paper that fit its part of the sitting: evenly spaced
 * through the paper (which rises in difficulty), auto-markable ones first.
 * The writing task is replaced by a short piece with its own rubric.
 */
function selectForBudget(paper) {
  const all = paper.sections.flatMap((s) => s.items);
  const writing = all.find((it) => it.type === "extended_text");
  let budget = BUDGET[paper.subject] ?? 13;
  const picked = [];
  if (writing) budget -= SHORT_WRITING_MINUTES;
  const candidates = all.filter((it) => it.type !== "extended_text");
  const needsPassage = candidates.some((it) => it.passage);
  if (needsPassage) budget -= PASSAGE_MINUTES;
  const auto = candidates.filter((it) => !/person|human|check/i.test(it.note ?? ""));
  const pool = auto.length >= 6 ? auto : candidates;
  const avg = pool.reduce((n, it) => n + minutesFor(it), 0) / pool.length;
  let n = Math.max(1, Math.floor(budget / avg));
  const chosen = new Set();
  const take = (count) => {
    chosen.clear();
    const stride = pool.length / count;
    for (let i = 0; i < count; i += 1) chosen.add(pool[Math.min(pool.length - 1, Math.floor(i * stride))]);
  };
  take(Math.min(n, pool.length));
  let total = [...chosen].reduce((m, it) => m + minutesFor(it), 0);
  while (total > budget && n > 1) {
    n -= 1;
    take(n);
    total = [...chosen].reduce((m, it) => m + minutesFor(it), 0);
  }
  // Fill any slack with the next unpicked items, in paper order.
  for (const it of pool) {
    if (chosen.has(it)) continue;
    if (total + minutesFor(it) <= budget) {
      chosen.add(it);
      total += minutesFor(it);
    }
  }
  for (const it of all) if (chosen.has(it)) picked.push(it.code);
  if (writing) picked.push(`${writing.code}-short`);
  return { codes: picked, minutes: Math.round(total + (writing ? SHORT_WRITING_MINUTES : 0) + (needsPassage ? PASSAGE_MINUTES : 0)) };
}
const TYPES = new Set(["single_choice", "multi_select", "numeric", "short_text", "matching", "ordering", "extended_text"]);

for (const p of papers) {
  if (!ENTRY[p.stage]) throw new Error(`${p.code}: no entry band for stage ${p.stage}`);
  for (const s of p.sections) {
    for (const it of s.items) {
      if (!TYPES.has(it.type)) throw new Error(`${it.code}: unsupported type ${it.type}`);
      if (it.media && !existsSync(join(dir, "media", it.media))) throw new Error(`${it.code}: media ${it.media} is missing`);
      if (it.passage && !(p.passages ?? []).some((q) => q.key === it.passage)) throw new Error(`${it.code}: passage ${it.passage} not in the paper`);
      if (it.type === "single_choice" && !(it.options ?? []).includes(it.key?.correct)) throw new Error(`${it.code}: correct answer is not an option`);
      if (it.type === "multi_select" && !(it.key?.correct ?? []).every((c) => (it.options ?? []).includes(c))) throw new Error(`${it.code}: a correct answer is not an option`);
      if (it.type === "matching" && !(it.pairs?.length >= 1)) throw new Error(`${it.code}: matching needs pairs`);
      if (it.type === "ordering" && !((it.options ?? []).length >= 2)) throw new Error(`${it.code}: ordering needs options`);
      if (it.type === "numeric" && typeof it.key?.value !== "number") throw new Error(`${it.code}: numeric needs a value`);
      if (it.type === "short_text" && !(it.key?.accepted?.length >= 1)) throw new Error(`${it.code}: short_text needs accepted answers`);
    }
  }
}

const BLOCK = String.raw`
do $seed$
declare
  pp jsonb := $json$__JSON__$json$::jsonb;
  v_code text; v_bank uuid; v_subj uuid; v_comp uuid; v_rubric uuid; v_pass uuid; v_q uuid; v_answer jsonb; v_partial boolean;
  sc jsonb; it jsonb; pg jsonb; opt text; pair jsonb; oi int; lbl text; v_left uuid; v_right uuid;
  rights jsonb;
begin
  v_code := pp->>'code';
  v_bank := md5('paper:bank:' || v_code)::uuid;
  select id into v_subj from public.subjects where code = pp->>'subject';
  if v_subj is null then raise exception 'unknown subject %', pp->>'subject'; end if;

  insert into public.question_banks (id, name, description, status)
  values (v_bank, pp->>'name', 'Digitised from ' || (pp->>'source') || '. Seeded from web/content/papers; edit there and re-run the seed.', 'active')
  on conflict (id) do update set name = excluded.name, description = excluded.description, status = 'active';

  -- The writing rubric for this stage: the Cambridge 25-mark grid as bands.
  select id into v_comp from public.competencies where code = 'written_language';
  v_rubric := md5('paper:rubric:stage' || (pp->>'stage'))::uuid;
  insert into public.rubrics (id, name, competency_id, max_marks, bands)
  values (v_rubric, 'Cambridge writing · Stage ' || (pp->>'stage'), v_comp, 25, $bands$[
    {"key":"emerging","label":"Emerging","min_marks":3,"descriptor":"A short or unclear piece (21 to 60 words earns at most 7). Some relevant ideas; simple sentences; punctuation and spelling inconsistent."},
    {"key":"developing","label":"Developing","min_marks":9,"descriptor":"Ideas relevant to the task with some detail; mostly simple sentences with some joining words; sentence punctuation mostly right; common words spelt correctly."},
    {"key":"secure","label":"Secure","min_marks":14,"descriptor":"Purpose and audience clear; paragraphs or sections in a sensible order; varied sentence structures and some well-chosen vocabulary; punctuation largely accurate; spelling mostly accurate including some harder words."},
    {"key":"strong","label":"Strong","min_marks":19,"descriptor":"Well-shaped text with an opening and ending; controlled paragraphs; a range of sentence types used for effect; precise vocabulary; accurate punctuation including commas and speech marks; spelling accurate."},
    {"key":"exceptional","label":"Exceptional","min_marks":23,"descriptor":"Assured, engaging writing that fully meets the task; deliberate structure and cohesion; ambitious vocabulary and grammar handled with control; virtually no errors."}
  ]$bands$::jsonb)
  on conflict (id) do update set name = excluded.name, competency_id = excluded.competency_id, max_marks = excluded.max_marks, bands = excluded.bands;

  -- The short piece that fits a 40-minute sitting: one paragraph, 8 marks.
  insert into public.rubrics (id, name, competency_id, max_marks, bands)
  values (md5('paper:rubric:short:stage' || (pp->>'stage'))::uuid, 'Cambridge writing, short piece · Stage ' || (pp->>'stage'), v_comp, 8, $bands$[
    {"key":"emerging","label":"Emerging","min_marks":1,"descriptor":"A few relevant ideas in simple sentences; punctuation and spelling inconsistent."},
    {"key":"developing","label":"Developing","min_marks":3,"descriptor":"Ideas relevant to the task and in a sensible order; some joining words; sentence punctuation mostly right; common words spelt correctly."},
    {"key":"secure","label":"Secure","min_marks":5,"descriptor":"Purpose and audience clear; varied sentences and some well-chosen vocabulary; punctuation and spelling largely accurate."},
    {"key":"strong","label":"Strong","min_marks":7,"descriptor":"A controlled, engaging paragraph with precise vocabulary, a range of sentence types and accurate punctuation and spelling."}
  ]$bands$::jsonb)
  on conflict (id) do update set name = excluded.name, competency_id = excluded.competency_id, max_marks = excluded.max_marks, bands = excluded.bands;

  for pg in select * from jsonb_array_elements(coalesce(pp->'passages', '[]'::jsonb)) loop
    insert into public.passages (id, bank_id, title, body)
    values (md5('paper:passage:' || v_code || ':' || (pg->>'key'))::uuid, v_bank, pg->>'title', pg->>'body')
    on conflict (id) do update set bank_id = excluded.bank_id, title = excluded.title, body = excluded.body;
  end loop;

  for sc in select * from jsonb_array_elements(pp->'sections') loop
    for it in select * from jsonb_array_elements(sc->'items') loop
      v_q := md5('paper:q:' || (it->>'code'))::uuid;
      select id into v_comp from public.competencies where code = it->>'competency';
      if v_comp is null then raise exception 'unknown competency % on %', it->>'competency', it->>'code'; end if;
      v_pass := case when it ? 'passage' then md5('paper:passage:' || v_code || ':' || (it->>'passage'))::uuid else null end;

      insert into public.questions (id, bank_id, competency_id, passage_id, type, stem, stem_media_path, marks, difficulty, grade_sort_min, grade_sort_max, status, external_code, adult_note)
      values (v_q, v_bank, v_comp, v_pass, it->>'type', it->>'stem',
              case when it ? 'media' then 'papers/media/' || (it->>'media') else null end,
              (it->>'marks')::numeric, coalesce((it->>'difficulty')::int, 3), null, null, 'active', it->>'code', it->>'note')
      on conflict (id) do update set bank_id = excluded.bank_id, competency_id = excluded.competency_id, passage_id = excluded.passage_id,
        type = excluded.type, stem = excluded.stem, stem_media_path = excluded.stem_media_path, marks = excluded.marks,
        difficulty = excluded.difficulty, status = 'active', external_code = excluded.external_code, adult_note = excluded.adult_note;

      -- Options: replaced wholesale, ids stable per (question, side, position).
      delete from public.question_options where question_id = v_q;
      v_answer := null; v_partial := coalesce((it->>'partial_credit')::boolean, false);

      case it->>'type'
        when 'single_choice', 'multi_select', 'ordering' then
          oi := 0;
          for opt in select * from jsonb_array_elements_text(it->'options') loop
            oi := oi + 1;
            insert into public.question_options (id, question_id, position, label)
            values (md5('paper:o:' || (it->>'code') || ':' || oi)::uuid, v_q, oi, opt);
          end loop;
          if it->>'type' = 'single_choice' then
            select jsonb_build_object('option_ids', jsonb_build_array(md5('paper:o:' || (it->>'code') || ':' || ord)::uuid)) into v_answer
            from jsonb_array_elements_text(it->'options') with ordinality as o(label, ord) where o.label = it->'key'->>'correct';
          elsif it->>'type' = 'multi_select' then
            select jsonb_build_object('option_ids', jsonb_agg(md5('paper:o:' || (it->>'code') || ':' || ord)::uuid order by ord)) into v_answer
            from jsonb_array_elements_text(it->'options') with ordinality as o(label, ord)
            where o.label in (select jsonb_array_elements_text(it->'key'->'correct'));
          else
            select jsonb_build_object('order', jsonb_agg(md5('paper:o:' || (it->>'code') || ':' || ord)::uuid order by ord)) into v_answer
            from jsonb_array_elements_text(it->'options') with ordinality as o(label, ord);
          end if;
        when 'matching' then
          -- Left options in pair order; right options de-duplicated by label.
          rights := '[]'::jsonb; oi := 0;
          for pair in select * from jsonb_array_elements(it->'pairs') loop
            oi := oi + 1;
            insert into public.question_options (id, question_id, position, label, side)
            values (md5('paper:o:' || (it->>'code') || ':L' || oi)::uuid, v_q, oi, pair->>0, 'left');
            if not rights ? (pair->>1) then rights := rights || to_jsonb(pair->>1); end if;
          end loop;
          oi := 0;
          for lbl in select * from jsonb_array_elements_text(rights) loop
            oi := oi + 1;
            insert into public.question_options (id, question_id, position, label, side)
            values (md5('paper:o:' || (it->>'code') || ':R' || oi)::uuid, v_q, oi, lbl, 'right');
          end loop;
          select jsonb_build_object('pairs', jsonb_agg(jsonb_build_array(
                   md5('paper:o:' || (it->>'code') || ':L' || p.ord)::uuid,
                   md5('paper:o:' || (it->>'code') || ':R' || r.ord)::uuid) order by p.ord)) into v_answer
          from jsonb_array_elements(it->'pairs') with ordinality as p(pair, ord)
          join jsonb_array_elements_text(rights) with ordinality as r(label, ord) on r.label = p.pair->>1;
        when 'numeric' then
          v_answer := jsonb_build_object('value', (it->'key'->>'value')::numeric, 'tolerance', coalesce((it->'key'->>'tolerance')::numeric, 0));
        when 'short_text' then
          v_answer := jsonb_build_object('accepted', it->'key'->'accepted');
        when 'extended_text' then
          v_answer := null;
      end case;

      if it->>'type' = 'extended_text' then
        insert into public.question_answers (question_id, answer, partial_credit, rubric_id) values (v_q, null, false, v_rubric)
        on conflict (question_id) do update set answer = null, partial_credit = false, rubric_id = excluded.rubric_id;
        -- The short version of the same task, for the 40-minute sitting.
        insert into public.questions (id, bank_id, competency_id, type, stem, marks, difficulty, status, external_code, adult_note)
        values (md5('paper:q:' || (it->>'code') || '-short')::uuid, v_bank, v_comp, 'extended_text',
                'You have about five minutes. Write ONE paragraph of five to eight sentences.' || E'\n\n' || (it->>'stem'),
                8, coalesce((it->>'difficulty')::int, 3), 'active', (it->>'code') || '-short',
                'Short form of the writing task, marked on the 8-mark short-piece rubric.')
        on conflict (id) do update set stem = excluded.stem, marks = 8, status = 'active', adult_note = excluded.adult_note;
        insert into public.question_answers (question_id, answer, partial_credit, rubric_id)
        values (md5('paper:q:' || (it->>'code') || '-short')::uuid, null, false, md5('paper:rubric:short:stage' || (pp->>'stage'))::uuid)
        on conflict (question_id) do update set answer = null, partial_credit = false, rubric_id = excluded.rubric_id;
      else
        if v_answer is null then raise exception 'no key built for %', it->>'code'; end if;
        insert into public.question_answers (question_id, answer, partial_credit, rubric_id) values (v_q, v_answer, v_partial, null)
        on conflict (question_id) do update set answer = excluded.answer, partial_credit = excluded.partial_credit, rubric_id = null;
      end if;
    end loop;
  end loop;
end $seed$;
`;

const TEMPLATE = String.raw`
do $seed$
declare
  t jsonb := $json$__JSON__$json$::jsonb;
  v_tmpl uuid; v_sec uuid; v_subj uuid; part jsonb; qcode text; si int := 0; qi int;
begin
  v_tmpl := md5('paper:template:' || (t->>'code'))::uuid;
  insert into public.assessment_templates (id, name, description, grade_sort_min, grade_sort_max, time_limit_minutes, status, delivery)
  values (v_tmpl, t->>'name', t->>'description', (t->>'min')::int, (t->>'max')::int, (t->>'minutes')::int, 'active', 'paper')
  on conflict (id) do update set name = excluded.name, description = excluded.description, grade_sort_min = excluded.grade_sort_min,
    grade_sort_max = excluded.grade_sort_max, time_limit_minutes = excluded.time_limit_minutes, status = 'active', delivery = 'paper';
  delete from public.template_sections where template_id = v_tmpl and position > jsonb_array_length(t->'parts');
  for part in select * from jsonb_array_elements(t->'parts') loop
    si := si + 1;
    v_sec := md5('paper:section:' || (t->>'code') || ':' || (part->>'subject'))::uuid;
    select id into v_subj from public.subjects where code = part->>'subject';
    insert into public.template_sections (id, template_id, position, title, subject_id, instructions, time_limit_minutes, selection)
    values (v_sec, v_tmpl, 1000 + si, part->>'title', v_subj, part->>'instructions', (part->>'minutes')::int, 'fixed')
    on conflict (id) do update set template_id = excluded.template_id, position = excluded.position, title = excluded.title,
      subject_id = excluded.subject_id, instructions = excluded.instructions, time_limit_minutes = excluded.time_limit_minutes, selection = 'fixed';
    delete from public.template_section_questions where section_id = v_sec;
    qi := 0;
    for qcode in select * from jsonb_array_elements_text(part->'codes') loop
      qi := qi + 1;
      insert into public.template_section_questions (section_id, question_id, position) values (v_sec, md5('paper:q:' || qcode)::uuid, qi);
    end loop;
  end loop;
  update public.template_sections set position = position - 1000 where template_id = v_tmpl and position > 1000;
end $seed$;
`;

const out = ["-- Generated by web/scripts/paper-seed.mjs. Do not edit; edit the JSON and re-run.", "begin;"];
for (const p of papers) {
  const json = JSON.stringify(p);
  if (json.includes("$json$") || json.includes("$bands$")) throw new Error(`${p.code}: content may not contain a dollar-quote delimiter`);
  out.push(`-- ${p.name}`);
  out.push(BLOCK.replace("__JSON__", json));
}

const byStage = new Map();
for (const p of papers) {
  if (!byStage.has(p.stage)) byStage.set(p.stage, []);
  byStage.get(p.stage).push(p);
}
for (const [stage, list] of [...byStage.entries()].sort((a, b) => a[0] - b[0])) {
  const entry = ENTRY[stage];
  const parts = SUBJECT_ORDER.filter((s) => list.some((p) => p.subject === s)).map((subject) => {
    const p = list.find((x) => x.subject === subject);
    const { codes } = selectForBudget(p);
    const minutes = BUDGET[subject];
    return {
      subject,
      title: `${subject[0].toUpperCase()}${subject.slice(1)}`,
      instructions: `From the Cambridge Stage ${stage} ${subject} paper. You have ${minutes} minutes for this part; the clock starts when you press Start. Answer every question you can; you may go back within the part.`,
      minutes,
      codes,
    };
  });
  const t = {
    code: `entry-${stage}`,
    name: `Cambridge Progression · entry to ${entry.label} (40 minutes)`,
    description: `A 40-minute selection from the Stage ${stage} English, Mathematics and Science papers: ${parts.map((x) => `${x.title} ${x.minutes} min`).join(", ")}. The full papers are in the banks; edit the parts to change the selection.`,
    min: entry.min,
    max: entry.max,
    minutes: parts.reduce((n, x) => n + x.minutes, 0),
    parts,
  };
  const json = JSON.stringify(t);
  if (json.includes("$json$")) throw new Error("template content may not contain the delimiter");
  out.push(`-- ${t.name}`);
  out.push(TEMPLATE.replace("__JSON__", json));
}
out.push("commit;");
process.stdout.write(out.join("\n") + "\n");
