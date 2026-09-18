-- The three payment emails stop promising online card payment where no
-- gateway can take the money.
--
-- The school's gateway is arranged in Botswana and settles in Pula.
-- Potchefstroom charges in Rand, and no South African gateway has been
-- arranged yet, so `lib/payments/online.ts` now refuses a Rand checkout and
-- the pay pages show the bank details instead. These three emails were the
-- part still pointing every family at a card button: "Pay securely online",
-- "Try again". A Potch parent following that link lands on a page with no
-- card button, which reads as the school's payment page being broken.
--
-- Two new variables carry the decision, mirrors of each other the way
-- `assessed` / `no_assessment` already are — the template language has
-- {{#if}} and no {{#unless}}:
--
--   pay_online     set when the configured gateway takes this request's
--                  currency, and when there is no request to ask about
--                  (nothing is hidden on a guess).
--   transfer_only  set only when it demonstrably cannot.
--
-- `paymentExtras` computes them from the payment request's own currency, so
-- these follow the campus without a per-campus rule anywhere: the day a
-- South African gateway is added to GATEWAY_CURRENCIES, every one of these
-- emails goes back to offering the card button with no migration.
--
-- The transfer-only wording still carries `{{payment_link}}`, under "what is
-- due and what we have received". The link is not only a card page — it is
-- where a family sees the outstanding balance — and a parent who has been
-- sent one before will look for it.
--
-- One thing fixed in passing: the HTML bodies told parents to use
-- {{application_reference}} as their banking reference while the plain-text
-- bodies told them {{reference_to_use}}, the child's name. The school asked
-- for the child's name (`lib/email/send.ts` says why: it is what the bursar
-- recognises on a statement), and the HTML body is what most parents read.
-- v3 says the child's name in both.

update email_templates
set is_active = false, updated_at = now()
where key in ('offer_accepted_pay', 'payment_reminder', 'payment_failed') and is_active;

insert into email_templates (key, version, name, description, subject, body_text, body_html, allowed_variables, is_active, audience)
select
  t.key,
  t.version + 1,
  t.name,
  t.description,
  t.subject,
  b.body_text,
  b.body_html,
  -- The allow-list is validated against the body at save time, so the two new
  -- names have to arrive with the bodies that use them.
  (select array_agg(distinct v order by v)
     from unnest(t.allowed_variables || array['pay_online', 'transfer_only']) as v),
  true,
  t.audience
from email_templates t
join (values
  (
    'offer_accepted_pay',
'Dear {{parent_first_name}},

Thank you for accepting the offer of a place for {{student_first_name}} at {{campus}} in {{grade}}.

To secure the place, the registration and admission fees of {{amount_due}} are due by {{payment_due_date}}.
{{#if pay_online}}
Pay securely online here:
{{payment_link}}
{{#if bank_details}}
Or pay by bank transfer:
{{bank_details}}
Please use the reference {{reference_to_use}} — your child''s name — so we can match your payment.
{{/if}}{{/if}}{{#if transfer_only}}{{#if bank_details}}
Please pay by bank transfer:
{{bank_details}}
Please use the reference {{reference_to_use}} — your child''s name — so we can match your payment.
{{/if}}
You can see what is due and what we have received here:
{{payment_link}}
{{/if}}
Once we have your payment, we will send a receipt and a link to complete registration.

Reference: {{application_reference}}

Warm regards,
Hibiscus International Schools Admissions',
    '<p>Dear {{parent_first_name}},</p>'
    || '<p>Thank you for accepting the offer of a place for <strong>{{student_first_name}}</strong> at <strong>{{campus}}</strong> in <strong>{{grade}}</strong>.</p>'
    || '<p>To secure the place, the registration and admission fees of <strong>{{amount_due}}</strong> are due by <strong>{{payment_due_date}}</strong>.</p>'
    || '{{#if pay_online}}<p><a href="{{payment_link}}" class="button">Pay securely online</a></p>'
    || '{{#if bank_details}}<p>Or pay by bank transfer:</p><p style="white-space:pre-line">{{bank_details}}</p>'
    || '<p>Please use the reference <strong>{{reference_to_use}}</strong> — your child''s name — so we can match your payment.</p>{{/if}}{{/if}}'
    || '{{#if transfer_only}}{{#if bank_details}}<p>Please pay by bank transfer:</p><p style="white-space:pre-line">{{bank_details}}</p>'
    || '<p>Please use the reference <strong>{{reference_to_use}}</strong> — your child''s name — so we can match your payment.</p>{{/if}}'
    || '<p><a href="{{payment_link}}" class="button">See what is due</a></p>{{/if}}'
    || '<p>Once we have your payment, we will send a receipt and a link to complete registration.</p>'
    || '<p>Reference: {{application_reference}}</p>'
    || '<p>Warm regards,<br>Hibiscus International Schools Admissions</p>'
  ),
  (
    'payment_reminder',
'Dear {{parent_first_name}},

A reminder that the registration and admission fees of {{amount_due}} for {{student_first_name}}''s place at {{campus}} are due by {{payment_due_date}}.
{{#if pay_online}}
Pay securely online here:
{{payment_link}}
{{#if bank_details}}
Or pay by bank transfer:
{{bank_details}}
Please use the reference {{reference_to_use}} — your child''s name.
{{/if}}{{/if}}{{#if transfer_only}}{{#if bank_details}}
Please pay by bank transfer:
{{bank_details}}
Please use the reference {{reference_to_use}} — your child''s name.
{{/if}}
You can see what is due and what we have received here:
{{payment_link}}
{{/if}}
If you have already paid by bank transfer, please ignore this email; we will confirm as soon as the payment reaches us.

Reference: {{application_reference}}

Hibiscus International Schools Admissions',
    '<p>Dear {{parent_first_name}},</p>'
    || '<p>A reminder that the registration and admission fees of <strong>{{amount_due}}</strong> for {{student_first_name}}''s place at {{campus}} are due by <strong>{{payment_due_date}}</strong>.</p>'
    || '{{#if pay_online}}<p><a href="{{payment_link}}" class="button">Pay securely online</a></p>'
    || '{{#if bank_details}}<p>Or pay by bank transfer:</p><p style="white-space:pre-line">{{bank_details}}</p>'
    || '<p>Please use the reference <strong>{{reference_to_use}}</strong> — your child''s name.</p>{{/if}}{{/if}}'
    || '{{#if transfer_only}}{{#if bank_details}}<p>Please pay by bank transfer:</p><p style="white-space:pre-line">{{bank_details}}</p>'
    || '<p>Please use the reference <strong>{{reference_to_use}}</strong> — your child''s name.</p>{{/if}}'
    || '<p><a href="{{payment_link}}" class="button">See what is due</a></p>{{/if}}'
    || '<p>If you have already paid by bank transfer, please ignore this email; we will confirm as soon as the payment reaches us.</p>'
    || '<p>Reference: {{application_reference}}</p>'
    || '<p>Hibiscus International Schools Admissions</p>'
  ),
  (
    'payment_failed',
'Dear {{parent_first_name}},

The online payment for {{student_first_name}}''s place at {{campus}} was not completed, so the fees of {{amount_due}} are still due by {{payment_due_date}}.
{{#if pay_online}}
You can try again here:
{{payment_link}}
{{#if bank_details}}
Or pay by bank transfer:
{{bank_details}}
Please use the reference {{reference_to_use}} — your child''s name.
{{/if}}{{/if}}{{#if transfer_only}}{{#if bank_details}}
Please pay by bank transfer:
{{bank_details}}
Please use the reference {{reference_to_use}} — your child''s name.
{{/if}}
You can see what is due and what we have received here:
{{payment_link}}
{{/if}}
If you believe you were charged, please contact the admissions office with your reference and we will check with the payment provider.

Reference: {{application_reference}}

Hibiscus International Schools Admissions',
    '<p>Dear {{parent_first_name}},</p>'
    || '<p>The online payment for {{student_first_name}}''s place at {{campus}} was not completed, so the fees of <strong>{{amount_due}}</strong> are still due by <strong>{{payment_due_date}}</strong>.</p>'
    || '{{#if pay_online}}<p><a href="{{payment_link}}" class="button">Try again</a></p>'
    || '{{#if bank_details}}<p>Or pay by bank transfer:</p><p style="white-space:pre-line">{{bank_details}}</p>'
    || '<p>Please use the reference <strong>{{reference_to_use}}</strong> — your child''s name.</p>{{/if}}{{/if}}'
    || '{{#if transfer_only}}{{#if bank_details}}<p>Please pay by bank transfer:</p><p style="white-space:pre-line">{{bank_details}}</p>'
    || '<p>Please use the reference <strong>{{reference_to_use}}</strong> — your child''s name.</p>{{/if}}'
    || '<p><a href="{{payment_link}}" class="button">See what is due</a></p>{{/if}}'
    || '<p>If you believe you were charged, please contact the admissions office with your reference and we will check with the payment provider.</p>'
    || '<p>Reference: {{application_reference}}</p>'
    || '<p>Hibiscus International Schools Admissions</p>'
  )
) as b(key, body_text, body_html) on b.key = t.key
where t.version = (select max(version) from email_templates m where m.key = t.key);
