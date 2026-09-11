-- The last two moments that send a WhatsApp companion and have no template.
--
-- Found by the audit trail on the day it went in, which is the point of it:
-- grouping today's skips by reason turned up two keys whose skip was not
-- "waiting for approval" but "no such row".
--
--   what_to_expect       skipped once,  10:30
--   offer_accepted_pay   skipped once,  09:34
--
-- Both are live, active email templates. The companion send looks up
-- `message_templates` by the email's key, finds nothing, and records
-- `no active message template for "…"` — correct behaviour, and invisible
-- until something was reading the skips.
--
-- These two are worse placed than the front door was. `offer_accepted_pay` is
-- the moment a family has just said yes and money is owed by a date; it is the
-- single most time-critical message the school sends, and it has been
-- email-only. `what_to_expect` is the one that reduces the number of children
-- who arrive anxious, or without water.
--
-- Seeded inactive with no provider id, like every template before approval.

-- ---------------------------------------------------------------------------
-- Before the assessment
-- ---------------------------------------------------------------------------

-- `next_step_link` is in the email's allowed_variables and is deliberately not
-- in `parameters`: a link never goes in the body, it goes in the button, where
-- the token is the button's own variable.
--
-- Each placeholder is used once — the same rule the front-door templates
-- follow, because a repeated variable is not something to discover at
-- approval or, worse, on a parent's phone.
insert into public.message_templates (key, name, language, body_preview, parameters, button_link, link_purpose, is_active, audience)
values (
  'what_to_expect',
  'What to expect at the assessment',
  'en',
  E'Hi {{1}}, {{2}}''s assessment at {{3}} is on {{4}} at {{5}}. There is nothing to revise for — please arrive 15 minutes early, with water and a small snack. Tap below to read what happens on the day.',
  array['parent_first_name', 'student_first_name', 'campus', 'assessment_date', 'assessment_time'],
  true,
  'next_step',
  false,
  'applicant'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- After the offer is accepted
-- ---------------------------------------------------------------------------

-- `payment_link` and `bank_details` are both in the email's variables and
-- neither belongs here: the first is a link, and the second is several lines
-- of account numbers, which is an email's job and would be unreadable as a
-- WhatsApp parameter. The button carries the payment link; the bank details
-- are one tap behind it on the same page.
insert into public.message_templates (key, name, language, body_preview, parameters, button_link, link_purpose, is_active, audience)
values (
  'offer_accepted_pay',
  'Offer accepted — fees due',
  'en',
  E'Hi {{1}}, thank you for accepting {{2}}''s place at {{3}}. {{4}} is due by {{5}} to secure it. Your reference is {{6}}. Tap below to pay securely or to see the bank details.',
  array['parent_first_name', 'student_first_name', 'campus', 'amount_due', 'payment_due_date', 'application_reference'],
  true,
  'payment',
  false,
  'applicant'
)
on conflict (key) do nothing;
