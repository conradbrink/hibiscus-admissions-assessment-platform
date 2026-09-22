-- The 2027 scholarship intake.
--
-- The school has awarded scholarships to 172 children and wants the whole
-- journey — letter, interview, decision, offer, registration — to run here
-- rather than on paper. This migration is the data half of that: four award
-- bands, the fee line one of them needs, and the two templates that reach a
-- family.
--
-- A scholarship is a promotion. That is not a shortcut, it is what the
-- promotions tables already describe: a named deal, scoped to a campus and a
-- grade band, whose effects waive some fees and discount others. Writing a
-- second mechanism beside it would mean a second way for fees to be wrong.
--
-- So: `waive_fee` on registration and admission, because nothing is payable
-- to accept a scholarship place, and `discount_percent` on termly tuition for
-- the award itself. `applyPromotion` discounts the snapshot, `fullyWaived`
-- reports nothing payable, and the acceptance path already writes a zero
-- payment and opens registration without touching a gateway.

-- ---------------------------------------------------------------------------
-- 1. A promotion may discount any fee the school actually charges
-- ---------------------------------------------------------------------------

-- `fee_lines.code` has been widened four times as the school's pricing grew;
-- `promotion_effects.fee_code` was never widened with it and still lists only
-- the four codes that existed in September. Today's scholarships happen to
-- use `tuition_term`, which survives — but a pre-school or Potchefstroom
-- scholarship would be refused by a constraint rather than by a decision, and
-- the error would arrive in a migration nobody was expecting to fail.
alter table public.promotion_effects drop constraint if exists promotion_effects_fee_code_check;
alter table public.promotion_effects add constraint promotion_effects_fee_code_check
  check (fee_code is null or fee_code in (
    'registration', 'admission',
    'tuition_month', 'tuition_month_half', 'tuition_month_full',
    'tuition_term', 'tuition_term_half', 'tuition_term_full',
    'tuition_annual', 'lunch_month', 'stationery_annual'
  ));

-- ---------------------------------------------------------------------------
-- 2. Form 5 has a tuition fee
-- ---------------------------------------------------------------------------

-- `Block 7 · Form 5 · 2027` carries a registration fee and an admission fee
-- and no tuition at all, so an offer for it would price at nothing and a
-- scholarship letter would have no figures to show. Form 5 is priced with
-- Form 3–4: P19,200 a term.
insert into public.fee_lines (schedule_id, code, label, amount_minor, payable_at_acceptance, position)
select fs.id, 'tuition_term', 'Tuition per term', 1920000, false, 30
from public.fee_schedules fs
join public.campuses c on c.id = fs.campus_id
join public.academic_years ay on ay.id = fs.academic_year_id
where c.name = 'Block 7' and ay.label = '2027' and fs.grade_sort_min = 170
on conflict (schedule_id, code) do nothing;

-- ---------------------------------------------------------------------------
-- 3. The four award bands
-- ---------------------------------------------------------------------------

-- Not code-redeemable: nobody types these in on the enquiry form. They are
-- attached to an application by the import, from the award column of the
-- school's own spreadsheet, so `code` exists only so staff can recognise one
-- in the promotions admin.
--
-- Deliberately not scoped to a campus or a grade band. The same four bands
-- cover Broadhurst primary and Block 7 secondary, and the primary cohort
-- follows as soon as its contact list arrives; a campus-scoped deal would
-- need duplicating the day it does.
insert into public.promotions (code, name, letter_text, starts_on, ends_on, is_active)
values
  ('SCHOLARSHIP-50', 'Scholarship — 50%',
   'This place is held under the Hibiscus scholarship programme, which covers 50% of tuition.',
   date '2026-09-22', date '2027-01-31', true),
  ('SCHOLARSHIP-40', 'Scholarship — 40%',
   'This place is held under the Hibiscus scholarship programme, which covers 40% of tuition.',
   date '2026-09-22', date '2027-01-31', true),
  ('SCHOLARSHIP-30', 'Scholarship — 30%',
   'This place is held under the Hibiscus scholarship programme, which covers 30% of tuition.',
   date '2026-09-22', date '2027-01-31', true),
  ('SCHOLARSHIP-20', 'Scholarship — 20%',
   'This place is held under the Hibiscus scholarship programme, which covers 20% of tuition.',
   date '2026-09-22', date '2027-01-31', true)
on conflict (code) do nothing;

-- Three effects apiece, in the order a parent reads them: what they do not
-- pay to accept, then what the award is worth each term.
insert into public.promotion_effects (promotion_id, position, kind, fee_code, percent, label)
select p.id, e.position, e.kind, e.fee_code, e.percent, e.label
from public.promotions p
join (values
  ('SCHOLARSHIP-50', 10, 'waive_fee', 'registration', null::numeric, 'Application fee waived'),
  ('SCHOLARSHIP-50', 20, 'waive_fee', 'admission', null, 'Admission fee waived'),
  ('SCHOLARSHIP-50', 30, 'discount_percent', 'tuition_term', 50, 'Scholarship — 50% of tuition'),
  ('SCHOLARSHIP-40', 10, 'waive_fee', 'registration', null, 'Application fee waived'),
  ('SCHOLARSHIP-40', 20, 'waive_fee', 'admission', null, 'Admission fee waived'),
  ('SCHOLARSHIP-40', 30, 'discount_percent', 'tuition_term', 40, 'Scholarship — 40% of tuition'),
  ('SCHOLARSHIP-30', 10, 'waive_fee', 'registration', null, 'Application fee waived'),
  ('SCHOLARSHIP-30', 20, 'waive_fee', 'admission', null, 'Admission fee waived'),
  ('SCHOLARSHIP-30', 30, 'discount_percent', 'tuition_term', 30, 'Scholarship — 30% of tuition'),
  ('SCHOLARSHIP-20', 10, 'waive_fee', 'registration', null, 'Application fee waived'),
  ('SCHOLARSHIP-20', 20, 'waive_fee', 'admission', null, 'Admission fee waived'),
  ('SCHOLARSHIP-20', 30, 'discount_percent', 'tuition_term', 20, 'Scholarship — 20% of tuition')
) as e(code, position, kind, fee_code, percent, label) on e.code = p.code
where not exists (
  select 1 from public.promotion_effects x where x.promotion_id = p.id and x.position = e.position
);

-- ---------------------------------------------------------------------------
-- 4. The interview deadline
-- ---------------------------------------------------------------------------

-- A date in settings rather than in code, because a deadline is the sort of
-- thing a school moves. The booking page reads it to stop offering slots past
-- it, and the letter and the WhatsApp both quote it, so all three agree by
-- construction rather than by somebody remembering to change three places.
insert into public.settings (key, value, description)
values
  ('scholarship_interview_deadline', to_jsonb('2026-10-09'::text),
   'The last day a scholarship family may book an interview. The booking page will not offer a later slot, and the invitation quotes this date. Blank switches the limit off.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 5. The invitation email
-- ---------------------------------------------------------------------------

-- The school's own letter, corrected. What was in the Word file and is not
-- here: "Term 11 to 3", "installments", "stationary", instalments "ending
-- August 2026" when nine payments from December 2026 end in August 2027, a
-- Block 7 letterhead over a body naming Broadhurst, "he/she" alongside "her",
-- and an instruction to accept by emailing the head of primary — which is
-- the very thing this system exists to replace.
--
-- The child is named rather than pronouned. The school does not hold a
-- gender for an applicant, and "he/she" in a letter about one specific child
-- reads as a form letter, which this is not meant to.
insert into public.email_templates (key, version, name, description, subject, body_text, body_html, allowed_variables, is_active, audience)
values (
  'scholarship_invitation', 1,
  'Scholarship invitation',
  'Sent once, when a scholarship application is created. Carries the award, the fees after it, and the link to book the interview.',
  'A scholarship for {{student_first_name}} at Hibiscus {{campus}}',
'Dear {{parent_first_name}},

RE: SCHOLARSHIP PROGRAMME FOR {{student_first_name}} {{student_last_name}}

We are delighted to inform you that {{student_first_name}} has been awarded a scholarship of {{scholarship_award}} of school fees for Terms 1 to 3 of the 2027 academic year at Hibiscus Schools, {{campus}}, in {{grade}}.

The award is confirmed once {{student_first_name}} has attended an interview with us. There is no entrance test — {{student_first_name}} does not sit an assessment.

Interviews must take place by {{interview_deadline}}. Choose a date and time that suits you here — it takes about a minute, and you can change it later if you need to:
{{next_step_link}}

To maintain this scholarship, we kindly request your cooperation in upholding the following conditions:

- Academic excellence: {{student_first_name}} will maintain a strong work ethic and strive for good academic results.
- Extracurricular activities: as {{student_first_name}} progresses through their schooling, they will take part in at least one afternoon activity of their choice.
- Positive representation: {{student_first_name}} and your family will represent Hibiscus Schools positively and act as ambassadors for the school when the opportunity arises.
- Financial commitment: fees are payable in nine equal instalments, the first due before 31 December 2026 and the last in August 2027.
- Prompt payment: consistent and timely payment according to this plan is essential to maintaining the scholarship. Failure to meet the schedule may result in its cancellation.
- Codes of conduct: the student must comply with the Student Code of Conduct, and parents or legal guardians with the Parent Code of Conduct. Failure to do so may result in cancellation.

Fees after the scholarship discount:
Each term — {{tuition_term}}

There is nothing to pay to accept this place. The application fee and the admission fee are both waived.

Additional costs: books, stationery, Cambridge Checkpoint examinations (Stage 7), Cambridge IGCSE examinations (Form 4), uniform, school trips and camps, and any other additional costs are not covered by the scholarship and must be paid in full.

We are confident that {{student_first_name}} will flourish at Hibiscus and look forward to supporting them in achieving their academic goals. Please do not hesitate to contact us should you require any further clarification.

One thing about WhatsApp: our updates are sent from an automatic number, and nobody reads replies to it. To talk to somebody about {{student_first_name}}, message us on {{campus_whatsapp}} or call {{campus_phone}}.

We look forward to seeing {{student_first_name}} grow as a future leader.

Sincerely,
Roelien Brink
C.E.O., Hibiscus Schools

Your reference is {{application_reference}}.',
    '<p>Dear {{parent_first_name}},</p>'
    || '<p><strong>RE: SCHOLARSHIP PROGRAMME FOR {{student_first_name}} {{student_last_name}}</strong></p>'
    || '<p>We are delighted to inform you that <strong>{{student_first_name}}</strong> has been awarded a scholarship of '
    || '<strong>{{scholarship_award}} of school fees</strong> for Terms 1 to 3 of the 2027 academic year at '
    || 'Hibiscus Schools, <strong>{{campus}}</strong>, in <strong>{{grade}}</strong>.</p>'
    || '<p>The award is confirmed once {{student_first_name}} has attended an interview with us. There is no entrance test — {{student_first_name}} does not sit an assessment.</p>'
    || '<p><strong>Interviews must take place by {{interview_deadline}}.</strong> Tap below to choose a date and time that suits you '
    || '— it takes about a minute, and you can change it later if you need to.</p>'
    || '<p><a href="{{next_step_link}}">Book your interview</a></p>'
    || '<p>To maintain this scholarship, we kindly request your cooperation in upholding the following conditions:</p>'
    || '<ul>'
    || '<li><strong>Academic excellence</strong> — {{student_first_name}} will maintain a strong work ethic and strive for good academic results.</li>'
    || '<li><strong>Extracurricular activities</strong> — as {{student_first_name}} progresses through their schooling, they will take part in at least one afternoon activity of their choice.</li>'
    || '<li><strong>Positive representation</strong> — {{student_first_name}} and your family will represent Hibiscus Schools positively and act as ambassadors for the school when the opportunity arises.</li>'
    || '<li><strong>Financial commitment</strong> — fees are payable in nine equal instalments, the first due <strong>before 31 December 2026</strong> and the last in August 2027.</li>'
    || '<li><strong>Prompt payment</strong> — consistent and timely payment according to this plan is essential to maintaining the scholarship. Failure to meet the schedule may result in its cancellation.</li>'
    || '<li><strong>Codes of conduct</strong> — the student must comply with the Student Code of Conduct, and parents or legal guardians with the Parent Code of Conduct. Failure to do so may result in cancellation.</li>'
    || '</ul>'
    || '<p><strong>Fees after the scholarship discount:</strong> {{tuition_term}} each term.</p>'
    || '<p><strong>There is nothing to pay to accept this place.</strong> The application fee and the admission fee are both waived.</p>'
    || '<p><strong>Additional costs</strong> — books, stationery, Cambridge Checkpoint examinations (Stage 7), Cambridge IGCSE examinations (Form 4), '
    || 'uniform, school trips and camps, and any other additional costs are not covered by the scholarship and must be paid in full.</p>'
    || '<p>We are confident that {{student_first_name}} will flourish at Hibiscus and look forward to supporting them in achieving their academic goals. '
    || 'Please do not hesitate to contact us should you require any further clarification.</p>'
    || '<p><strong>One thing about WhatsApp:</strong> our updates are sent from an automatic number, and nobody reads replies to it. '
    || 'To talk to somebody about {{student_first_name}}, message us on <strong>{{campus_whatsapp}}</strong> or call <strong>{{campus_phone}}</strong>.</p>'
    || '<p>We look forward to seeing {{student_first_name}} grow as a future leader.</p>'
    || '<p>Sincerely,<br><strong>Roelien Brink</strong><br>C.E.O., Hibiscus Schools</p>'
    || '<p style="color:#666;font-size:12px">Your reference is {{application_reference}}.</p>',
  array[
    'parent_first_name', 'student_first_name', 'student_last_name',
    'scholarship_award', 'campus', 'grade', 'interview_deadline',
    'tuition_term', 'next_step_link', 'application_reference',
    'campus_whatsapp', 'campus_phone'
  ],
  true, 'parent'
)
on conflict (key, version) do nothing;

-- ---------------------------------------------------------------------------
-- 6. The offer letter, for after the interview
-- ---------------------------------------------------------------------------

-- A second key alongside 'standard'. `offer_templates_one_active_idx` is per
-- key, so both stay active and `loadActiveOfferTemplate` picks by key.
--
-- This is the letter the family receives once the interview has happened and
-- the place is confirmed — the invitation above is what gets them there. The
-- difference matters: the invitation promises a scholarship pending an
-- interview, and this one grants the place.
insert into public.offer_templates (key, version, name, description, body_html, terms_html, allowed_variables, is_active)
select
  'scholarship', 1,
  'Scholarship offer of a place',
  'The offer letter for a child on the scholarship programme. Same shape as the standard letter, with the award and the waived fees said out loud.',
    '<h1>Offer of a place</h1>'
    || '<p>Dear {{parent_first_name}},</p>'
    || '<p>Following {{student_first_name}}''s interview, we are delighted to confirm a place at '
    || '<strong>{{campus}}</strong> in <strong>{{grade}}</strong>, starting {{start_date}}.</p>'
    || '<p>{{student_first_name}} holds a <strong>{{scholarship_award}}</strong> scholarship. '
    || 'The fees below are what remains after it.</p>'
    || '<h2>Fees</h2>'
    || '<p>{{fees_table}}</p>'
    || '<p><strong>There is nothing to pay to accept this place.</strong> The application fee and the admission fee are both waived '
    || 'under the scholarship programme. Fees are payable in nine equal instalments, the first due before 31 December 2026.</p>'
    || '<h2>What happens next</h2>'
    || '<p>Accept the place using the link in your email, and the registration form opens straight away. '
    || 'If you would like to talk to somebody first, message us on {{campus_whatsapp}} or call {{campus_phone}}.</p>'
    || '<p>We look forward to welcoming {{student_first_name}}.</p>'
    || '<p>Sincerely,<br><strong>Roelien Brink</strong><br>C.E.O., Hibiscus Schools</p>',
  t.terms_html,
  (select array_agg(distinct v order by v)
     from unnest(t.allowed_variables || array['scholarship_award', 'interview_deadline']) as v),
  true
from public.offer_templates t
where t.key = 'standard' and t.is_active
on conflict (key, version) do nothing;

-- ---------------------------------------------------------------------------
-- 7. The WhatsApp companion
-- ---------------------------------------------------------------------------

-- Declared but **inactive**, and deliberately so: the wording is with Meta for
-- approval and there is no provider id for it yet. The row cannot be switched
-- on without one, which is the guard doing its job rather than a gap.
--
-- It is here rather than added later because the template coverage suite
-- refuses a parent-facing email nobody has decided about — and "we are waiting
-- on Meta" is a decision, where silence is how `fresh_link` ended up with no
-- companion and nobody noticing for a month.
--
-- The wording obeys what this week taught us: it opens on a word rather than a
-- variable, closes on one too, and no variable can carry a newline. The manned
-- number is last because a parent who has just been told not to reply here
-- needs somewhere to go in the same breath.
insert into public.message_templates (key, name, language, body_preview, parameters, button_link, link_purpose, is_active, audience)
values (
  'scholarship_invitation', 'Scholarship invitation', 'en',
  E'Hi {{1}}, we are delighted to tell you that {{2}} has been awarded a {{3}} scholarship at Hibiscus {{4}} for 2027. Please book an interview before {{5}} — tap below to choose a time. The full letter is in your email. Replies to this number are not read — message {{6}} if you need us.',
  array['parent_first_name', 'student_first_name', 'scholarship_award', 'campus', 'interview_deadline', 'campus_whatsapp'],
  true, 'next_step', false, 'applicant'
)
on conflict (key) do nothing;
