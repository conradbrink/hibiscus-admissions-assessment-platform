-- Align the message templates to the wording actually submitted to Zavu.
--
-- Sixteen templates were created in Zavu from the template pack and are with
-- Meta for review. The database has to match them, not the other way round:
-- once Meta approves a template, its variable list is fixed, and a send whose
-- parameter count disagrees is refused — or worse, filled in the wrong order,
-- which reaches a parent looking like a real message with a campus name where
-- a date belongs.
--
-- Two corrections and eight additions.
--
-- ---------------------------------------------------------------------------
-- The corrections
-- ---------------------------------------------------------------------------
--
-- `20260911290000_missing_companions.sql` seeded `what_to_expect` and
-- `offer_accepted_pay` from wording written a couple of hours after the pack
-- was handed over, so the two drifted apart. The pack is what went to Zavu.
--
--   what_to_expect      same five variables in the same order, different
--                       prose. Sends correctly either way; what was wrong is
--                       the recorded `rendered_text`, which is supposed to be
--                       what the parent actually read.
--
--   offer_accepted_pay  FOUR variables in the pack, SIX in the seed. This one
--                       would have failed on its first real send, which is the
--                       moment a family has just accepted a place and owes
--                       money by a date — about the worst message to lose.
--
-- Both are rewritten to the pack, exactly.

update public.message_templates set
  body_preview = E'Hi {{1}}, {{2}}''s assessment at {{3}} is on {{4}} at {{5}}. There is nothing to bring and nothing to revise — we provide everything. Tap below for what the morning looks like.',
  parameters = array['parent_first_name', 'student_first_name', 'campus', 'assessment_date', 'assessment_time'],
  button_link = true,
  link_purpose = 'next_step'
where key = 'what_to_expect';

update public.message_templates set
  body_preview = E'Hi {{1}}, thank you for accepting {{2}}''s place. {{3}} is due by {{4}} to secure it. Tap below to pay, or reply here if you would rather arrange a transfer.',
  parameters = array['parent_first_name', 'student_first_name', 'amount_due', 'payment_due_date'],
  button_link = true,
  link_purpose = 'payment'
where key = 'offer_accepted_pay';

-- ---------------------------------------------------------------------------
-- The eight additions
-- ---------------------------------------------------------------------------
--
-- These were the `known_gap` list in `template_coverage.sql`: real moments
-- with no WhatsApp companion. They now exist in Zavu, which on its own does
-- nothing — the send looks the key up here, finds no row, and skips. Each is
-- the pack's wording and variable order, verified against the matching email
-- template's `allowed_variables` so no parameter renders empty.
--
-- Inactive with no provider id, like every template before approval.

insert into public.message_templates (key, name, language, body_preview, parameters, button_link, link_purpose, is_active, audience)
values
  ('enquiry_nudge', 'Enquiry not yet booked', 'en',
   E'Hi {{1}}, you asked about a place for {{2}} at {{3}} but have not booked an assessment yet. Tap below to choose a time — it takes about a minute.',
   array['parent_first_name', 'student_first_name', 'campus'], true, 'next_step', false, 'applicant'),

  ('assessment_completed', 'Assessment completed', 'en',
   E'Hi {{1}}, {{2}} has finished the assessment at {{3}}. Thank you for bringing them. We will be in touch with the result and what happens next. Your reference is {{4}}.',
   array['parent_first_name', 'student_first_name', 'campus', 'application_reference'], true, 'next_step', false, 'applicant'),

  -- The only one of the sixteen with no button: there is nothing for a parent
  -- to do but wait for the call, and a button that opens a page saying so is
  -- worse than no button.
  ('callback_received', 'Callback request received', 'en',
   E'Hi {{1}}, thank you — we have your request for a call about {{2}}. Somebody from admissions will ring you within one working day. Your reference is {{3}}.',
   array['parent_first_name', 'student_first_name', 'application_reference'], false, 'next_step', false, 'applicant'),

  ('payment_received', 'Payment received', 'en',
   E'Hi {{1}}, we have received {{2}} for {{3}}''s place at {{4}}. Thank you. The next step is the registration form — tap below.',
   array['parent_first_name', 'amount_paid', 'student_first_name', 'campus'], true, 'registration', false, 'applicant'),

  ('registration_received', 'Registration received', 'en',
   E'Hi {{1}}, we have received {{2}}''s registration. Your reference is {{3}}. We will tell you if anything is missing. Tap below to check it at any time.',
   array['parent_first_name', 'student_first_name', 'application_reference'], true, 'registration', false, 'applicant'),

  -- What the detail actually is stays in the email: it is free text written by
  -- whoever spotted it, and an approved template cannot carry that.
  ('document_mismatch', 'Please check a detail', 'en',
   E'Hi {{1}}, we need you to check one detail on {{2}}''s registration before we can finish it. Tap below to see what it is and put it right.',
   array['parent_first_name', 'student_first_name'], true, 'registration', false, 'applicant'),

  ('fees_none', 'Place secured, nothing to pay', 'en',
   E'Hi {{1}}, {{2}}''s place at {{3}} in {{4}} is secured — there is nothing to pay to accept it. The next step is the registration form, tap below.',
   array['parent_first_name', 'student_first_name', 'campus', 'grade'], true, 'registration', false, 'applicant'),

  -- Which promotion applied stays in the email, for the same reason as the
  -- mismatch detail above.
  ('fees_waived', 'Place secured, fees waived', 'en',
   E'Hi {{1}}, {{2}}''s place at {{3}} in {{4}} is secured and the fees have been waived. The next step is the registration form — tap below.',
   array['parent_first_name', 'student_first_name', 'campus', 'grade'], true, 'registration', false, 'applicant')
on conflict (key) do nothing;
