-- Two things the offer letter gets wrong, and the field one of them needs.
--
-- 1. It tells a family "we will email you everything you need before Term 3,
--    2026 starts". Term 3 2026 started on 7 September and was still being
--    offered on the 10th, so the letter was promising to write before a date
--    three days past. The sentence is right for a term that has not started
--    and wrong for one that has, so it is guarded rather than reworded.
--
-- 2. Pre-school is charged per term at two rates — half day and full day —
--    and the letter had no way to say which. A schedule holds one line per
--    code, so the two rates are two codes; which one a child is on is a fact
--    about the child, which is what `day_pattern` is for.

-- ---------------------------------------------------------------------------
-- How long the child's day is
-- ---------------------------------------------------------------------------

-- Null is the ordinary state, not a gap to be filled in later out of duty: a
-- place is usually offered before the school and the family have settled the
-- day pattern, and the letter shows both rates until they do. Only
-- pre-school grades are ever priced this way; every other grade ignores it.
alter table public.applications
  add column if not exists day_pattern text
  check (day_pattern in ('half', 'full'));

comment on column public.applications.day_pattern is
  'Half or full day for a pre-school child, or null when the school has not said. Chooses which term rate the offer letter quotes.';

-- ---------------------------------------------------------------------------
-- The letter
-- ---------------------------------------------------------------------------

-- `allowed_variables` is an allow-list checked when a template is saved, so a
-- variable the body uses but this list omits makes the template unsaveable.
-- Three go in: the tense flag and the two rates.
update public.offer_templates
   set allowed_variables = (
         select array(
           select distinct v
             from unnest(allowed_variables || array['intake_not_started', 'tuition_term_half', 'tuition_term_full']) as v
            order by v
         )
       )
 where not (allowed_variables @> array['intake_not_started']);

-- The opening sentence, and the closing promise, each in two versions. The
-- renderer has no {{else}} — deliberately, it is a fifteen-line template
-- language — so this is two guarded sentences whose conditions are opposites,
-- which reads no worse in the source and is one fewer thing to implement.
update public.offer_templates
   set body_html = replace(
         body_html,
         'for <strong>{{intake}}</strong>. The term starts on {{start_date}}.',
         'for <strong>{{intake}}</strong>. {{#if intake_not_started}}The term starts on {{start_date}}.{{/if}}{{#if intake_started}}The term started on {{start_date}}.{{/if}}'
       )
 where body_html like '%The term starts on {{start_date}}.%';

update public.offer_templates
   set body_html = replace(
         body_html,
         '<p>We will email you everything you need before {{intake}} starts.</p>',
         '<p>{{#if intake_not_started}}We will email you everything you need before {{intake}} starts.{{/if}}{{#if intake_started}}{{intake}} is already under way, so we will email you everything you need for {{student_first_name}}''s first day.{{/if}}</p>'
       )
 where body_html like '%We will email you everything you need before {{intake}} starts.%';

-- `intake_started` is the complement, and needs allowing too.
update public.offer_templates
   set allowed_variables = (
         select array(
           select distinct v from unnest(allowed_variables || array['intake_started']) as v order by v
         )
       )
 where not (allowed_variables @> array['intake_started']);

-- The two term rates, shown side by side when no day pattern has been set.
-- Placed immediately after the single-rate row so the table reads in one
-- order however a campus prices things.
update public.offer_templates
   set body_html = replace(
         body_html,
         '{{#if tuition_term}}<tr><td>Tuition per term (the school invoices this each term)</td><td>{{tuition_term}}</td></tr>{{/if}}',
         '{{#if tuition_term}}<tr><td>Tuition per term (the school invoices this each term)</td><td>{{tuition_term}}</td></tr>{{/if}}'
         || '{{#if tuition_term_half}}<tr><td>Tuition per term — half day (the school invoices this each term)</td><td>{{tuition_term_half}}</td></tr>{{/if}}'
         || '{{#if tuition_term_full}}<tr><td>Tuition per term — full day (the school invoices this each term)</td><td>{{tuition_term_full}}</td></tr>{{/if}}'
       )
 where body_html like '%{{#if tuition_term}}%'
   and body_html not like '%tuition_term_half%';

-- Said in words as well as in the table, because two prices in a fee table
-- with no explanation reads as two charges rather than a choice.
update public.offer_templates
   set body_html = replace(
         body_html,
         '<p>Please tell the school office if your contact details change.',
         '{{#if tuition_term_half}}<p>Half day and full day are both available. Tell the school which suits you and we will confirm the term fee; nothing above needs to be paid to accept this offer.</p>{{/if}}<p>Please tell the school office if your contact details change.'
       )
 where body_html like '%tuition_term_half%'
   and body_html not like '%Half day and full day are both available%';
