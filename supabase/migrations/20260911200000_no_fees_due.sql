-- Accepting an offer that costs nothing to accept.
--
-- Bana Tlokweng charges nothing to secure a place. Their fee sheet says
-- "Registration Fees: None", and all ten of their active schedules are built
-- that way. But createPaymentRequest threw on a zero amount unless a promotion
-- had waived it, and it threw *after* the acceptance row and the offer's
-- accepted status were already committed — so a parent pressing Accept saw an
-- error, the application was stranded in a state no screen could advance, and
-- pressing it again hit the unique index and said the offer had already been
-- answered. Nobody had reached the offer stage at Tlokweng yet, so no
-- application needs repairing; this stops the first one falling in.
--
-- Two things were missing, and both are about telling the truth to the parent.

-- 1. A payment method meaning "nothing was ever due", distinct from 'waived',
--    which means "something was due and a deal removed it". The distinction is
--    not pedantic: it picks the email, the receipt wording and what finance
--    sees.
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments
  add constraint payments_method_check check (method in ('online', 'eft', 'waived', 'none'));

comment on column public.payments.method is
  'online and eft are money moving. waived means a promotion removed a fee that was owed; none means nothing was owed in the first place.';

-- 2. The email that goes with it. fees_waived tells a parent their fees were
--    waived, which at Tlokweng would be a small lie about a deal they never
--    got. Same shape, same next step, honest sentence.
insert into public.email_templates (key, version, name, description, subject, body_html, body_text, allowed_variables, is_active, audience)
select 'fees_none', 1, 'No fees due: place secured',
  'Sent instead of the payment receipt when nothing is payable to secure the place — a campus that charges no acceptance fee, rather than a promotion.',
  '{{student_first_name}}''s place is secured',
  '<p>Dear {{parent_first_name}},</p><p>Thank you for accepting the offer. {{student_first_name}}''s place at {{campus}} in {{grade}} is now secured.</p><p>There is nothing to pay to hold the place. Any school fees are invoiced separately by the campus.</p><p>The last step is registration. This is the information the school needs before {{student_first_name}} starts. We already have the details you gave us earlier, so it is quick.</p><p><a href="{{registration_link}}" class="button">Complete registration</a></p><p>Reference: {{application_reference}}</p><p>Warm regards,<br>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\nThank you for accepting the offer. {{student_first_name}}''s place at {{campus}} in {{grade}} is now secured.\n\nThere is nothing to pay to hold the place. Any school fees are invoiced separately by the campus.\n\nThe last step is registration. This is the information the school needs before {{student_first_name}} starts. We already have the details you gave us earlier, so it is quick.\n\nComplete registration here:\n{{registration_link}}\n\nReference: {{application_reference}}\n\nWarm regards,\nHibiscus International Schools Admissions',
  array['parent_first_name','student_first_name','campus','grade','application_reference','registration_link','next_step_link'],
  true, 'parent'
where not exists (select 1 from public.email_templates where key = 'fees_none');
