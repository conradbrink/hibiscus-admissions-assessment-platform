-- WhatsApp for the front door: the enquiry, and the visit.
--
-- Thirteen templates went live this morning and the first real enquiry through
-- the form sent nothing, correctly: the two moments it reached —
-- `preschool_enquiry_received` and `visit_confirmed` — had no WhatsApp
-- companion, and neither did `enquiry_received`.
--
-- Those three are the front door. Every family starts at an enquiry, and a
-- pre-school family only ever sees the enquiry and the visit, so on the set
-- that was live a pre-school parent heard nothing on WhatsApp until an offer
-- was being drafted for them — by which point the school had asked them to
-- opt in to a channel it never used.
--
-- Seeded inactive with no provider id, like every template before approval.
-- `message_templates_check` refuses an active row without one, so these appear
-- greyed out until Zavu approves the wording and somebody pastes the id in.

-- ---------------------------------------------------------------------------
-- The assessed track's first message
-- ---------------------------------------------------------------------------

-- Each placeholder is used once. Meta allows a variable to repeat and Zavu
-- does not document whether it does, so the wording is written to avoid
-- finding out on a parent's phone: "{{4}} in {{4}}" would read fine here and
-- fail at approval or, worse, at send.
insert into public.message_templates (key, name, language, body_preview, parameters, button_link, link_purpose, is_active, audience)
values (
  'enquiry_received',
  'Enquiry received',
  'en',
  'Hi {{1}}, thank you for your enquiry for {{2}} to join {{3}} in {{4}}. Your reference is {{5}}. Your next step is to book an assessment — tap below, it takes about a minute.',
  array['parent_first_name', 'student_first_name', 'campus', 'grade', 'application_reference'],
  true,
  'next_step',
  false,
  'applicant'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- The pre-school track's first message
-- ---------------------------------------------------------------------------

-- Says the two things a pre-school parent needs and an assessed parent does
-- not: that there is no assessment to sit, and that the school comes back to
-- them rather than the other way round. The visit is offered, not demanded —
-- it changes nothing about the decision.
insert into public.message_templates (key, name, language, body_preview, parameters, button_link, link_purpose, is_active, audience)
values (
  'preschool_enquiry_received',
  'Enquiry received — pre-school',
  'en',
  'Hi {{1}}, thank you for your enquiry for {{2}} to join {{3}}. Your reference is {{4}}. Pre-school children do not sit an assessment — our admissions team will check availability and come back to you. Tap below if you would like to see the campus first.',
  array['parent_first_name', 'student_first_name', 'campus', 'application_reference'],
  true,
  'next_step',
  false,
  'applicant'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- The visit
-- ---------------------------------------------------------------------------

-- A visit sends one confirmation and nothing after it — no reminder, and
-- nothing notices a family who does not arrive. Putting the confirmation on
-- WhatsApp does not fix that, but it does put the date somewhere a parent can
-- find it without going back through their email.
--
-- `assessment_date` and `assessment_time` carry the visit's date and time too;
-- the variables were named for the first thing that used them.
insert into public.message_templates (key, name, language, body_preview, parameters, button_link, link_purpose, is_active, audience)
values (
  'visit_confirmed',
  'Visit booked',
  'en',
  'Hi {{1}}, your visit to {{2}} is booked for {{3}} at {{4}}. Your reference is {{5}} — give your name or the reference at reception. Tap below to view or change it.',
  array['parent_first_name', 'campus', 'assessment_date', 'assessment_time', 'application_reference'],
  true,
  'next_step',
  false,
  'applicant'
)
on conflict (key) do nothing;
