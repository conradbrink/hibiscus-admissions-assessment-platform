-- ---------------------------------------------------------------------------
-- Offer letter: the conditions paragraph reads as a condition of the place
-- ---------------------------------------------------------------------------
--
-- Data only. Staff now tick the school's standard conditions (a learning
-- facilitator, a lower stage, extra tutoring, a therapist's report, and so
-- on) and the letter carries them as numbered sentences. The paragraph is
-- reworded so a parent reads them as conditions of the offer, and the terms
-- say what a condition means. Every offer already sent keeps its own text.

update public.offer_templates set is_active = false where key = 'standard' and is_active;
insert into public.offer_templates (key, version, name, description, body_html, terms_html, allowed_variables, is_active)
select
  'standard',
  coalesce(max(version), 0) + 1,
  'Standard offer of admission',
  'The offer letter in plain English: congratulations, the class and intake, the fees to pay to accept, any welcome offer, the conditions of the place, the account details.',
  replace(
    (select t.body_html from public.offer_templates t where t.key = 'standard' order by t.version desc limit 1),
    '{{#if conditions}}<p><strong>Conditions:</strong> {{conditions}}</p>{{/if}}',
    '{{#if conditions}}<p><strong>This offer is made on the following conditions:</strong> {{conditions}} Please contact the admissions office if you would like to discuss any of them.</p>{{/if}}'
  ),
  $terms$<h2>Terms</h2><p>Your child's place is secured when you have paid the application and admission fees in full, or when the school has waived them under a written offer. These fees are in {{currency}}. They are not refundable. Where the offer lists conditions, the place depends on the family meeting them by the time stated, or the school may withdraw it. The school invoices tuition each term, following its published fee schedule and payment options. Admission follows the school's policies. The parent or guardian accepts these policies at registration.</p>$terms$,
  (select t.allowed_variables from public.offer_templates t where t.key = 'standard' order by t.version desc limit 1),
  true
from public.offer_templates where key = 'standard';
