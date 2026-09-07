-- The offer letter in the school's own words, the campus letterheads, and
-- the account details a parent pays into.
--
-- 1. The standard offer template may quote the bank details, and version 2
--    follows the school's own offer letter: congratulations, the class and
--    intake, what is payable up front to accept, the account details, and
--    no signature (each campus has its own head of school).
-- 2. Every campus carries the address and phone lines its letters print,
--    as published on hibiscusschools.com, unless a person has already set
--    them.
-- 3. The BWP account details from the school's letters, unless a person
--    has already saved some.
begin;

update public.offer_templates
   set allowed_variables = array_append(allowed_variables, 'bank_details')
 where key = 'standard' and not ('bank_details' = any(allowed_variables));

update public.offer_templates set is_active = false where key = 'standard' and is_active;

insert into public.offer_templates (key, version, name, description, body_html, terms_html, allowed_variables, is_active)
select
  'standard',
  coalesce(max(version), 0) + 1,
  'Standard offer of admission',
  'The offer letter in the school''s words: congratulations, the class and intake, what is payable up front to accept, the account details. No signature; each campus has its own head of school.',
  $body$<p><strong>OFFER LETTER: {{student_first_name}} {{student_last_name}}</strong></p><p>Dear {{parent_first_name}} {{parent_last_name}},</p><p>Congratulations! This letter is to notify you that <strong>{{student_first_name}} {{student_last_name}}</strong> has been offered a place, following a successful intake assessment, and may join our <strong>{{grade}}</strong> class at <strong>{{campus}}</strong> for <strong>{{intake}}</strong>, starting {{start_date}}.</p><p>Payment confirms that you accept the offer for your child's entry with Hibiscus International Schools. Once payment has been made, your child's place is secured for the intake.</p><p>The following is payable up front to accept the offer:</p><table class="details">{{#if registration_fee}}<tr><td>Application fee (non-refundable)</td><td>{{registration_fee}}</td></tr>{{/if}}{{#if admission_fee}}<tr><td>Admission fee (non-refundable)</td><td>{{admission_fee}}</td></tr>{{/if}}{{#if tuition_term}}<tr><td>Tuition per term, invoiced by the school</td><td>{{tuition_term}}</td></tr>{{/if}}{{#if tuition_annual}}<tr><td>Annual tuition, invoiced by the school</td><td>{{tuition_annual}}</td></tr>{{/if}}<tr><td><strong>Payable to accept</strong></td><td><strong>{{amount_due}}</strong></td></tr></table>{{#if conditions}}<p><strong>Conditions:</strong> {{conditions}}</p>{{/if}}{{#if bank_details}}<p><strong>Account details:</strong> {{bank_details}}. Please use the reference {{application_reference}} when paying and send proof of payment to the admissions office.</p>{{/if}}<p>Please ensure you communicate changes of any personal information to the school administration so that you receive all necessary correspondence.</p><p>All the necessary information pertaining to the start of {{intake}} will be emailed in due course.</p><p>This offer is open until <strong>{{offer_expiry_date}}</strong>. Reference: {{application_reference}}.</p><p>We look forward to having you as part of our family at Hibiscus International Schools.</p><p>Kind regards,<br>Admissions, Hibiscus International Schools</p>$body$,
  $terms$<h2>Terms</h2><p>The place is secured when the application and admission fees have been paid in full. These fees are payable in {{currency}} and are not refundable. Tuition is invoiced by the school per term according to its published fee schedule and payment options. Admission is subject to the school's policies, which the parent or guardian accepts on enrolment.</p>$terms$,
  (select t.allowed_variables from public.offer_templates t where t.key = 'standard' order by t.version desc limit 1),
  true
from public.offer_templates where key = 'standard';

update public.campuses set address = v.address
from (values
  ('phase2',      E'Plot 53896/M61, Phase 2, Gaborone\n+267 315 9846\nMain office +267 72 320 145'),
  ('phase4',      E'Plot 24043, Phase 4, Gaborone\n+267 391 9744\nMain office +267 72 320 145'),
  ('village',     E'Plot 54693, The Village, Gaborone\n+267 390 2318\nMain office +267 72 320 145'),
  ('sarona_city', E'Tsholofelo East, Gaborone\n+267 396 0304\nMain office +267 72 320 145'),
  ('tlokweng',    E'Plot 6066, Tlokweng\n+267 72 320 145'),
  ('broadhurst',  E'Plot 76965, Broadhurst, Gaborone\n+267 311 7007\nMain office +267 72 320 145'),
  ('block7',      E'Plot 59140, Block 7, Gaborone\n+267 392 4299\nMain office +267 72 320 145'),
  ('potch',       E'Potchefstroom CBD, South Africa\n+267 72 320 145')
) as v(code, address)
where campuses.code = v.code and campuses.address is null;

update public.campuses set descriptor = 'Pre-School and Day Care Centre'
 where code = 'potch' and descriptor = 'CBD Maury Avenue, Potchefstroom';

insert into public.bank_instructions (currency, campus_id, body_text, is_active)
select 'BWP', null, E'Bank: FNB Corporate Centre\nAccount name: Hibiscus Schools (PTY) Ltd\nAccount number: 62924850185\nBranch code: 282267', true
where not exists (select 1 from public.bank_instructions where currency = 'BWP');

commit;
