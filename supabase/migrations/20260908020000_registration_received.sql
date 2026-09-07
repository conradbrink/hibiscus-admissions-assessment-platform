-- ---------------------------------------------------------------------------
-- Registration received: a confirmation on every submission, then a reminder
-- ---------------------------------------------------------------------------
--
-- Data only. When a parent presses Submit on the registration form they
-- now hear at once that it arrived, with anything still outstanding (a
-- section not filled in, a document not uploaded) named; if all is there,
-- the email says the school will check and confirm. A reminder follows
-- `documents_reminder_days` later and skips itself once registration is
-- complete. The reminders at 7 and 14 days after payment are unchanged.

insert into public.email_templates (key, version, name, description, subject, body_html, body_text, allowed_variables, is_active, audience)
select 'registration_received', 1, 'Registration received',
  'Sent the moment a parent submits the registration form, naming anything still outstanding, or saying everything is in.',
  'We have received {{student_first_name}}''s registration',
  '<p>Dear {{parent_first_name}},</p><p>Thank you. We have received the registration form for <strong>{{student_first_name}}</strong>.</p>{{#if outstanding_items}}<p>To finish, we still need {{outstanding_items}}.</p><p><a href="{{registration_link}}" class="button">Continue registration</a></p><p>A clear photo taken with a phone is fine for a document, as is a PDF. We will send a reminder in a few days if anything is still missing.</p>{{/if}}{{#if all_received}}<p>Everything we asked for is here. The admissions office will check the documents and confirm {{student_first_name}}''s enrolment; you will receive a welcome email when that is done.</p>{{/if}}<p>Reference: {{application_reference}}</p><p>Warm regards,<br>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\nThank you. We have received the registration form for {{student_first_name}}.\n{{#if outstanding_items}}\nTo finish, we still need {{outstanding_items}}.\n\nContinue here:\n{{registration_link}}\n\nA clear photo taken with a phone is fine for a document, as is a PDF. We will send a reminder in a few days if anything is still missing.\n{{/if}}{{#if all_received}}\nEverything we asked for is here. The admissions office will check the documents and confirm {{student_first_name}}''s enrolment; you will receive a welcome email when that is done.\n{{/if}}\nReference: {{application_reference}}\n\nWarm regards,\nHibiscus International Schools Admissions',
  array['parent_first_name','student_first_name','application_reference','outstanding_items','all_received','missing_documents','registration_link','next_step_link'],
  true, 'parent'
where not exists (select 1 from public.email_templates where key = 'registration_received');

insert into public.settings (key, value, description) values
  ('documents_reminder_days', '2', 'Days after a registration is submitted with items outstanding before the parent is reminded.')
on conflict (key) do nothing;
