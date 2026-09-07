-- Plain English for every parent. The wording a parent reads follows CEFR
-- B1 to B2: short sentences, one idea each, common words, active voice, no
-- idioms. This publishes new versions of the offer letter and of the emails
-- whose sentences were long or used phrases that do not travel. Templates
-- already at that level are left as they are. Nothing about when a message
-- is sent changes.
begin;

create function pg_temp.bump_email(p_key text, p_html text, p_text text) returns void
language plpgsql as $$
declare v_next int;
begin
  select max(version) + 1 into v_next from public.email_templates where key = p_key;
  if v_next is null then raise exception 'template_key_unknown: %', p_key; end if;
  update public.email_templates set is_active = false where key = p_key and is_active;
  insert into public.email_templates (key, version, name, description, subject, body_html, body_text, allowed_variables, is_active, audience)
  select key, v_next, name, description, subject, p_html, p_text, allowed_variables, true, audience
    from public.email_templates where key = p_key order by version desc limit 1;
end $$;

select pg_temp.bump_email('assessment_completed',
  '<p>Dear {{parent_first_name}},</p><p><strong>{{student_first_name}} completed the assessment today.</strong></p><p>You do not need to do anything now. We are preparing {{student_first_name}}''s learning profile. We will email it to you with the outcome of the application.</p><p>Reference: {{application_reference}}</p><p>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\n{{student_first_name}} completed the assessment today.\n\nYou do not need to do anything now. We are preparing {{student_first_name}}''s learning profile. We will email it to you with the outcome of the application.\n\nReference: {{application_reference}}\n\nHibiscus International Schools Admissions');

select pg_temp.bump_email('no_show_reschedule',
  '<p>Dear {{parent_first_name}},</p><p>{{student_first_name}} had an assessment booked today, but we did not see you. That is not a problem.</p><p>You can choose a new time here. It takes one minute:</p><p><a href="{{next_step_link}}">Choose a new time</a></p><p>If you no longer want to continue, you do not need to do anything.</p><p>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\n{{student_first_name}} had an assessment booked today, but we did not see you. That is not a problem.\n\nYou can choose a new time here. It takes one minute:\n{{next_step_link}}\n\nIf you no longer want to continue, you do not need to do anything.\n\nHibiscus International Schools Admissions');

select pg_temp.bump_email('offer_expired',
  '<p>Dear {{parent_first_name}},</p><p>The offer of a place for {{student_first_name}} at {{campus}} in {{grade}} ended on {{offer_expiry_date}}.</p><p>Do you still want the place? Reply to this email or call the admissions office. We will try to help.</p><p>Reference: {{application_reference}}</p><p>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\nThe offer of a place for {{student_first_name}} at {{campus}} in {{grade}} ended on {{offer_expiry_date}}.\n\nDo you still want the place? Reply to this email or call the admissions office. We will try to help.\n\nReference: {{application_reference}}\n\nHibiscus International Schools Admissions');

select pg_temp.bump_email('outcome_declined',
  '<p>Dear {{parent_first_name}},</p><p>Thank you for bringing {{student_first_name}} to the assessment, and for your interest in Hibiscus International Schools.</p><p>We are sorry. We cannot offer {{student_first_name}} a place in {{grade}} at {{campus}} this time.</p>{{#if results_link}}<p>{{student_first_name}}''s learning profile is ready. It shows strengths and areas to develop. We hope it helps you, whatever you decide next:</p><p><a href="{{results_link}}">Read the learning profile</a></p>{{/if}}<p>If you would like to talk about the assessment, reply to this email. A member of our admissions team will contact you.</p><p>Reference: {{application_reference}}</p><p>With best wishes,<br>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\nThank you for bringing {{student_first_name}} to the assessment, and for your interest in Hibiscus International Schools.\n\nWe are sorry. We cannot offer {{student_first_name}} a place in {{grade}} at {{campus}} this time.\n\n{{#if results_link}}{{student_first_name}}''s learning profile is ready. It shows strengths and areas to develop. We hope it helps you, whatever you decide next:\n{{results_link}}\n\n{{/if}}If you would like to talk about the assessment, reply to this email. A member of our admissions team will contact you.\n\nReference: {{application_reference}}\n\nWith best wishes,\nHibiscus International Schools Admissions');

select pg_temp.bump_email('outcome_waitlisted',
  '<p>Dear {{parent_first_name}},</p><p>Thank you for bringing {{student_first_name}} to the assessment. {{student_first_name}}''s learning profile is ready and is yours to keep:</p><p><a href="{{results_link}}">Read the learning profile</a></p><p>{{student_first_name}} met our admission criteria. But {{grade}} at {{campus}} is full at the moment. We have put {{student_first_name}} on the waiting list. We will contact you as soon as a place is free.</p><p>Reference: {{application_reference}}</p><p>Warm regards,<br>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\nThank you for bringing {{student_first_name}} to the assessment. {{student_first_name}}''s learning profile is ready and is yours to keep:\n{{results_link}}\n\n{{student_first_name}} met our admission criteria. But {{grade}} at {{campus}} is full at the moment. We have put {{student_first_name}} on the waiting list. We will contact you as soon as a place is free.\n\nReference: {{application_reference}}\n\nWarm regards,\nHibiscus International Schools Admissions');

select pg_temp.bump_email('payment_received',
  '<p>Dear {{parent_first_name}},</p><p>Thank you. We received your payment of {{amount_paid}} ({{payment_reference}}, {{payment_date}}). {{student_first_name}}''s place at {{campus}} in {{grade}} is now secured. Your receipt is attached.</p><p>The last step is registration. This is the information the school needs before {{student_first_name}} starts. We already have the details you gave us earlier, so it is quick.</p><p><a href="{{registration_link}}">Complete registration</a></p><p>Reference: {{application_reference}}</p><p>Warm regards,<br>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\nThank you. We received your payment of {{amount_paid}} ({{payment_reference}}, {{payment_date}}). {{student_first_name}}''s place at {{campus}} in {{grade}} is now secured. Your receipt is attached.\n\nThe last step is registration. This is the information the school needs before {{student_first_name}} starts. We already have the details you gave us earlier, so it is quick.\n\nComplete registration here:\n{{registration_link}}\n\nReference: {{application_reference}}\n\nWarm regards,\nHibiscus International Schools Admissions');

select pg_temp.bump_email('what_to_expect',
  '<p>Dear {{parent_first_name}},</p><p>Here is what happens on {{assessment_date}}.</p><p>{{student_first_name}} will do a short assessment on a computer in our learning centre. It covers English and Mathematics. Older children also do some reasoning activities. It takes between 45 and 90 minutes, depending on the grade.</p><p>There is nothing to prepare or study. A good night''s sleep and breakfast are enough.</p><p>After the assessment, we will email you {{student_first_name}}''s learning profile. It shows strengths and areas to develop. It is yours to keep, whatever the outcome.</p><p>See you on {{assessment_date}} at {{assessment_time}}.</p><p>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\nHere is what happens on {{assessment_date}}.\n\n{{student_first_name}} will do a short assessment on a computer in our learning centre. It covers English and Mathematics. Older children also do some reasoning activities. It takes between 45 and 90 minutes, depending on the grade.\n\nThere is nothing to prepare or study. A good night''s sleep and breakfast are enough.\n\nAfter the assessment, we will email you {{student_first_name}}''s learning profile. It shows strengths and areas to develop. It is yours to keep, whatever the outcome.\n\nSee you on {{assessment_date}} at {{assessment_time}}.\n\nHibiscus International Schools Admissions');

select pg_temp.bump_email('document_mismatch',
  '<p>Dear {{parent_first_name}},</p><p>Thank you for uploading {{student_first_name}}''s documents. One detail on a document is different from the registration form:</p><p>{{mismatch_details}}</p><p>Please open the registration and compare the form with the document. If the document is right, correct the form. If the form is right, you do not need to change anything. The school will contact you.</p><p><a href="{{registration_link}}">Open the registration</a></p><p>Reference: {{application_reference}}</p><p>Kind regards,<br>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\nThank you for uploading {{student_first_name}}''s documents. One detail on a document is different from the registration form:\n\n{{mismatch_details}}\n\nPlease open the registration and compare the form with the document. If the document is right, correct the form. If the form is right, you do not need to change anything. The school will contact you.\n\n{{registration_link}}\n\nReference: {{application_reference}}\n\nKind regards,\nHibiscus International Schools Admissions');

select pg_temp.bump_email('enquiry_nudge',
  '<p>Dear {{parent_first_name}},</p><p>You asked about {{student_first_name}} joining {{campus}}, but you have not chosen an assessment time yet. Places are limited, so please book soon:</p><p><a href="{{next_step_link}}">Book an assessment</a></p><p>If you have any questions, reply to this email.</p><p>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\nYou asked about {{student_first_name}} joining {{campus}}, but you have not chosen an assessment time yet. Places are limited, so please book soon:\n{{next_step_link}}\n\nIf you have any questions, reply to this email.\n\nHibiscus International Schools Admissions');

select pg_temp.bump_email('enquiry_received',
  '<p>Dear {{parent_first_name}},</p><p>Thank you for your interest in Hibiscus International Schools. We received your enquiry for {{student_first_name}} to join {{campus}} in {{grade}}.</p><p>Your reference is <strong>{{application_reference}}</strong>. Please keep it. You will need it when you contact us.</p><p>Your next step is to book an assessment. It takes about one minute:</p><p><a href="{{next_step_link}}">Book an assessment</a></p><p>Warm regards,<br>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\nThank you for your interest in Hibiscus International Schools. We received your enquiry for {{student_first_name}} to join {{campus}} in {{grade}}.\n\nYour reference is {{application_reference}}. Please keep it. You will need it when you contact us.\n\nYour next step is to book an assessment. It takes about one minute:\n{{next_step_link}}\n\nWarm regards,\nHibiscus International Schools Admissions');

select pg_temp.bump_email('preschool_enquiry_received',
  '<p>Dear {{parent_first_name}},</p><p>Thank you for your interest in Hibiscus International Schools. We received your enquiry for {{student_first_name}} to join {{campus}} in {{grade}}.</p><p>Your reference is <strong>{{application_reference}}</strong>.</p><p>Children joining {{grade}} do not do an assessment. Our admissions team will check if there is a place and contact you soon. If you would like to see the campus first, you can book a visit here:</p><p><a href="{{next_step_link}}">Book a visit</a></p><p>Warm regards,<br>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\nThank you for your interest in Hibiscus International Schools. We received your enquiry for {{student_first_name}} to join {{campus}} in {{grade}}.\n\nYour reference is {{application_reference}}.\n\nChildren joining {{grade}} do not do an assessment. Our admissions team will check if there is a place and contact you soon. If you would like to see the campus first, you can book a visit here:\n{{next_step_link}}\n\nWarm regards,\nHibiscus International Schools Admissions');

-- The offer letter, version 3: the same letter, in shorter sentences.
update public.offer_templates set is_active = false where key = 'standard' and is_active;
insert into public.offer_templates (key, version, name, description, body_html, terms_html, allowed_variables, is_active)
select
  'standard',
  coalesce(max(version), 0) + 1,
  'Standard offer of admission',
  'The offer letter in plain English: congratulations, the class and intake, the fees to pay to accept, the account details. No signature; each campus has its own head of school.',
  $body$<p><strong>OFFER LETTER: {{student_first_name}} {{student_last_name}}</strong></p><p>Dear {{parent_first_name}} {{parent_last_name}},</p><p>Congratulations! <strong>{{student_first_name}} {{student_last_name}}</strong> passed the intake assessment. We are happy to offer {{student_first_name}} a place in our <strong>{{grade}}</strong> class at <strong>{{campus}}</strong> for <strong>{{intake}}</strong>. The term starts on {{start_date}}.</p><p>To accept the offer, please pay the fees below. When we receive your payment, {{student_first_name}}'s place is secured.</p><p>Please pay these fees to accept the offer:</p><table class="details">{{#if registration_fee}}<tr><td>Application fee (non-refundable)</td><td>{{registration_fee}}</td></tr>{{/if}}{{#if admission_fee}}<tr><td>Admission fee (non-refundable)</td><td>{{admission_fee}}</td></tr>{{/if}}{{#if tuition_term}}<tr><td>Tuition per term (the school invoices this each term)</td><td>{{tuition_term}}</td></tr>{{/if}}{{#if tuition_annual}}<tr><td>Tuition per year (the school invoices this)</td><td>{{tuition_annual}}</td></tr>{{/if}}<tr><td><strong>Total to pay now</strong></td><td><strong>{{amount_due}}</strong></td></tr></table>{{#if conditions}}<p><strong>Conditions:</strong> {{conditions}}</p>{{/if}}{{#if bank_details}}<p><strong>Account details:</strong> {{bank_details}}. Please use the reference {{application_reference}} when you pay. Then send proof of payment to the admissions office.</p>{{/if}}<p>Please tell the school office if your contact details change. Then you will receive all our messages.</p><p>We will email you everything you need before {{intake}} starts.</p><p>This offer is open until <strong>{{offer_expiry_date}}</strong>. Reference: {{application_reference}}.</p><p>We look forward to welcoming {{student_first_name}} to the Hibiscus family.</p><p>Kind regards,<br>Admissions, Hibiscus International Schools</p>$body$,
  $terms$<h2>Terms</h2><p>Your child's place is secured when you have paid the application and admission fees in full. These fees are in {{currency}}. They are not refundable. The school invoices tuition each term, following its published fee schedule and payment options. Admission follows the school's policies. The parent or guardian accepts these policies at registration.</p>$terms$,
  (select t.allowed_variables from public.offer_templates t where t.key = 'standard' order by t.version desc limit 1),
  true
from public.offer_templates where key = 'standard';

commit;
