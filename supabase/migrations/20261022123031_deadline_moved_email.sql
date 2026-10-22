-- The email a family gets when the school moves their deadline.
--
-- On 22 October 2026 the school moved every scholarship family's deadline to
-- 5 December 2026 — the offer's closing date for families still to accept,
-- including those whose offers had lapsed, and the payment due date for
-- families who had accepted and not yet paid — and asked for each family to
-- be told in writing. No template said that: `offer_reminder` and
-- `payment_reminder` read as nudges, and the payment one names "the
-- registration and admission fees", which a scholarship family does not pay.
--
-- One template for both situations, because the news is the same: the date
-- moved, here it is, here is what to do by then. `offer_open` and `fees_due`
-- are exclusive flags set by the sender (web/lib/workflow/deadline-actions.ts),
-- two of them because the template language has {{#if}} and no {{else}}.
-- `new_deadline` is the date itself, passed by the sender too, so the subject
-- reads the same whichever date the family is working to.
--
-- Email only: no `message_templates` row, and the key is listed in
-- `email_only` in supabase/tests/template_coverage.sql.

insert into public.email_templates (key, version, name, description, audience, subject, body_html, body_text, allowed_variables, is_active)
values (
  'deadline_moved',
  1,
  'Deadline moved',
  'Sent when staff move a family''s deadline: the offer''s closing date before they accept, or the payment due date after. Says the new date and what to do by then.',
  'parent',
  '{{student_first_name}}''s place at {{campus}}: the new deadline is {{new_deadline}}',
  '<p>Dear {{parent_first_name}},</p>'
  || '<p>We have moved the deadline for {{student_first_name}}''s place in <strong>{{grade}}</strong> at <strong>{{campus}}</strong>. The new deadline is <strong>{{new_deadline}}</strong>.</p>'
  || '{{#if offer_open}}<p>To keep the place, please accept the offer and pay <strong>{{amount_due}}</strong> by {{new_deadline}}.</p>'
  || '<p><a href="{{offer_link}}" class="button">View the offer</a></p>{{/if}}'
  || '{{#if fees_due}}<p>To keep the place, please pay <strong>{{amount_due}}</strong> by {{new_deadline}}.</p>'
  || '{{#if pay_online}}<p><a href="{{payment_link}}" class="button">Pay securely online</a></p>{{#if bank_details}}<p>Or pay by bank transfer:</p><p style="white-space:pre-line">{{bank_details}}</p><p>Please use the reference <strong>{{reference_to_use}}</strong> — your child''s name.</p>{{/if}}{{/if}}'
  || '{{#if transfer_only}}{{#if bank_details}}<p>Please pay by bank transfer:</p><p style="white-space:pre-line">{{bank_details}}</p><p>Please use the reference <strong>{{reference_to_use}}</strong> — your child''s name.</p>{{/if}}<p><a href="{{payment_link}}" class="button">See what is due</a></p>{{/if}}'
  || '<p>If you have already paid by bank transfer, please ignore this part. We will confirm as soon as the payment reaches us.</p>{{/if}}'
  || '<p>If you have any questions, simply reply to this email.</p>'
  || '<p>Reference: {{application_reference}}</p>'
  || '<p>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\n'
  || E'We have moved the deadline for {{student_first_name}}''s place in {{grade}} at {{campus}}. The new deadline is {{new_deadline}}.\n\n'
  || E'{{#if offer_open}}To keep the place, please accept the offer and pay {{amount_due}} by {{new_deadline}}.\n\nView the offer: {{offer_link}}\n\n{{/if}}'
  || E'{{#if fees_due}}To keep the place, please pay {{amount_due}} by {{new_deadline}}.\n\nSee what is due: {{payment_link}}\n\n'
  || E'{{#if bank_details}}You can pay by bank transfer:\n{{bank_details}}\nPlease use the reference {{reference_to_use}} — your child''s name.\n\n{{/if}}'
  || E'If you have already paid by bank transfer, please ignore this part. We will confirm as soon as the payment reaches us.\n\n{{/if}}'
  || E'If you have any questions, simply reply to this email.\n\n'
  || E'Reference: {{application_reference}}\n\n'
  || E'Hibiscus International Schools Admissions',
  array['parent_first_name', 'student_first_name', 'campus', 'grade', 'new_deadline', 'offer_open', 'fees_due', 'amount_due', 'offer_link', 'payment_link', 'pay_online', 'transfer_only', 'bank_details', 'reference_to_use', 'application_reference'],
  true
)
on conflict (key, version) do nothing;
