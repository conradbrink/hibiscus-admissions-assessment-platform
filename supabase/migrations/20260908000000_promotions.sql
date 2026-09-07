-- ---------------------------------------------------------------------------
-- Promotions: a deal defined once, applied to offers, frozen on each letter
-- ---------------------------------------------------------------------------
--
-- A promotion is a named campaign ("Launch 2027") with a window, an optional
-- code the parent types at enquiry, who qualifies, and a list of effects:
-- waive a fee line, discount a line by an amount or a percentage, or add a
-- gift line with no money behind it. It is applied when an offer is drafted
-- (by code, by rule, or by a member of staff with a reason) and the result
-- is frozen into the offer's fee snapshot, so a later change to the deal
-- never alters a letter already sent. When every payable line is waived the
-- payment step is skipped and a "waived" payment record explains why nothing
-- was collected.

create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  -- One plain-English sentence for the letter, optional: "Welcome to the
  -- Hibiscus family: this offer includes our Launch 2027 gifts."
  letter_text text,
  campus_id uuid references public.campuses(id) on delete cascade,
  academic_year_id uuid references public.academic_years(id) on delete cascade,
  grade_sort_min int,
  grade_sort_max int,
  entry_route text check (entry_route is null or entry_route in ('assessment', 'visit', 'callback')),
  heard_from text check (heard_from is null or heard_from in (
    'search', 'social_media', 'friend_family', 'current_parent', 'school_event', 'radio_print', 'signage', 'other'
  )),
  starts_on date,
  ends_on date,
  max_redemptions int check (max_redemptions is null or max_redemptions > 0),
  is_active boolean not null default false,
  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (code is null or code ~ '^[A-Z0-9-]{3,24}$'),
  check (grade_sort_min is null or grade_sort_max is null or grade_sort_max >= grade_sort_min),
  check (starts_on is null or ends_on is null or ends_on >= starts_on)
);

create table if not exists public.promotion_effects (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  position int not null default 0,
  kind text not null check (kind in ('waive_fee', 'discount_fixed', 'discount_percent', 'gift')),
  fee_code text check (fee_code is null or fee_code in ('registration', 'admission', 'tuition_annual', 'tuition_term')),
  amount_minor bigint check (amount_minor is null or amount_minor >= 0),
  percent numeric(5, 2) check (percent is null or (percent > 0 and percent <= 100)),
  -- How the effect reads to the parent: "Application fee waived",
  -- "P1,000 uniform voucher", "Hibiscus hat and T-shirt".
  label text not null,
  check ((kind = 'gift' and fee_code is null) or (kind <> 'gift' and fee_code is not null)),
  check (kind <> 'discount_fixed' or amount_minor is not null),
  check (kind <> 'discount_percent' or percent is not null)
);
create index if not exists promotion_effects_promotion_idx on public.promotion_effects(promotion_id, position);

-- One promotion per application, applied once.
create table if not exists public.application_promotions (
  application_id uuid primary key references public.applications(id) on delete cascade,
  promotion_id uuid not null references public.promotions(id) on delete restrict,
  source text not null check (source in ('code', 'rule', 'staff')),
  applied_by uuid references public.staff_profiles(id) on delete set null,
  reason text,
  applied_at timestamptz not null default now()
);
create index if not exists application_promotions_promotion_idx on public.application_promotions(promotion_id);

-- The code the parent typed at enquiry, kept even when it did not match, so
-- staff can see what was attempted.
alter table public.applications add column if not exists promo_code text;
alter table public.offers add column if not exists promotion_id uuid references public.promotions(id) on delete set null;

-- A fully waived offer has nothing to pay: the request and the record of
-- "nothing collected, and why" carry zero.
alter table public.payment_requests drop constraint if exists payment_requests_amount_minor_check;
alter table public.payment_requests add constraint payment_requests_amount_minor_check check (amount_minor >= 0);
alter table public.payments drop constraint if exists payments_amount_minor_check;
alter table public.payments add constraint payments_amount_minor_check check (amount_minor >= 0);
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check check (method in ('online', 'eft', 'waived'));
alter table public.payments drop constraint if exists payments_provider_check;
alter table public.payments add constraint payments_provider_check check (provider in ('dev', 'dpo', 'paygate', 'bank', 'none'));

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.promotions enable row level security;
alter table public.promotion_effects enable row level security;
alter table public.application_promotions enable row level security;

drop policy if exists promotions_select on public.promotions;
create policy promotions_select on public.promotions
  for select using (
    (select public.has_permission('offers.read')) or (select public.has_permission('applications.read'))
  );
drop policy if exists promotions_write on public.promotions;
create policy promotions_write on public.promotions
  for all using ((select public.has_permission('settings.write')))
  with check ((select public.has_permission('settings.write')));

drop policy if exists promotion_effects_select on public.promotion_effects;
create policy promotion_effects_select on public.promotion_effects
  for select using (
    (select public.has_permission('offers.read')) or (select public.has_permission('applications.read'))
  );
drop policy if exists promotion_effects_write on public.promotion_effects;
create policy promotion_effects_write on public.promotion_effects
  for all using ((select public.has_permission('settings.write')))
  with check ((select public.has_permission('settings.write')));

-- Applicant data: read with the application, campus-scoped; no staff writes
-- (the offer actions apply a promotion through the service role).
drop policy if exists application_promotions_select on public.application_promotions;
create policy application_promotions_select on public.application_promotions
  for select using (
    exists (
      select 1 from public.applications a
      where a.id = application_promotions.application_id
        and (select public.has_permission('applications.read'))
        and (select public.can_access_campus(a.campus_id))
    )
  );

-- ---------------------------------------------------------------------------
-- v_application_facts: + promotion_code, promotion_name (appended)
-- ---------------------------------------------------------------------------

create or replace view public.v_application_facts
with (security_invoker = true)
as
select
  m.application_id,
  m.campus_id,
  c.name as campus_name,
  m.grade_id,
  g.name as grade_name,
  g.sort_order as grade_sort,
  m.intake_id,
  i.label as intake_label,
  i.starts_on as intake_starts_on,
  i.academic_year_id,
  m.entry_route,
  m.source,
  m.requires_assessment,
  m.status,
  m.enquired_at,
  m.booked_at,
  m.attended_at,
  m.no_show_at,
  m.assessed_at,
  m.decided_at,
  m.offered_at,
  m.accepted_at,
  m.paid_at,
  m.enrolled_at,
  (select min(ev.occurred_at) from public.application_events ev
     where ev.application_id = m.application_id and ev.type = 'application.withdrawn') as withdrawn_at,
  (select d.final_outcome from public.admission_decisions d
     where d.application_id = m.application_id and d.final_outcome <> 'staff_review'
     order by d.decided_at desc limit 1) as decision_outcome,
  (select o.status from public.offers o
     where o.application_id = m.application_id
     order by o.created_at desc limit 1) as offer_status,
  (select coalesce(sum(pr.paid_minor), 0) from public.payment_requests pr
     where pr.application_id = m.application_id)::bigint as paid_minor,
  (select count(*) from public.email_messages e
     where e.application_id = m.application_id and e.status <> 'failed')::int as emails_sent,
  (select count(*) from public.messages x
     where x.application_id = m.application_id and x.direction = 'out' and x.status in ('sent', 'delivered', 'read'))::int as messages_sent,
  (select count(*) from public.application_events ev
     where ev.application_id = m.application_id and ev.type = 'booking.no_show')::int as no_show_count,
  coalesce(r.prefilled_count, 0) as prefilled_count,
  coalesce(r.prefill_changed_count, 0) as prefill_changed_count,
  (r.submitted_at is not null) as registration_submitted,
  a.heard_from,
  pr.code as promotion_code,
  pr.name as promotion_name
from public.v_application_milestones m
join public.campuses c on c.id = m.campus_id
join public.grades g on g.id = m.grade_id
join public.intakes i on i.id = m.intake_id
left join public.registrations r on r.application_id = m.application_id
left join public.applications a on a.id = m.application_id
left join public.application_promotions ap on ap.application_id = m.application_id
left join public.promotions pr on pr.id = ap.promotion_id;

-- ---------------------------------------------------------------------------
-- The letter and the results email learn about the deal
-- ---------------------------------------------------------------------------

-- Offer letter, version 4: the fee lines print "Waived" where a promotion
-- waived them, and a "Your welcome offer" paragraph lists the gifts.
update public.offer_templates set is_active = false where key = 'standard' and is_active;
insert into public.offer_templates (key, version, name, description, body_html, terms_html, allowed_variables, is_active)
select
  'standard',
  coalesce(max(version), 0) + 1,
  'Standard offer of admission',
  'The offer letter in plain English: congratulations, the class and intake, the fees to pay to accept, any welcome offer, the account details.',
  $body$<p><strong>OFFER LETTER: {{student_first_name}} {{student_last_name}}</strong></p><p>Dear {{parent_first_name}} {{parent_last_name}},</p><p>Congratulations! <strong>{{student_first_name}} {{student_last_name}}</strong> passed the intake assessment. We are happy to offer {{student_first_name}} a place in our <strong>{{grade}}</strong> class at <strong>{{campus}}</strong> for <strong>{{intake}}</strong>. The term starts on {{start_date}}.</p>{{#if promotion_name}}<p><strong>Your welcome offer ({{promotion_name}}):</strong> {{promotion_lines}}.{{#if promotion_text}} {{promotion_text}}{{/if}}</p>{{/if}}<p>To accept the offer, please pay the fees below. When we receive your payment, {{student_first_name}}'s place is secured.</p><p>Please pay these fees to accept the offer:</p><table class="details">{{#if registration_fee}}<tr><td>Application fee (non-refundable)</td><td>{{registration_fee}}</td></tr>{{/if}}{{#if admission_fee}}<tr><td>Admission fee (non-refundable)</td><td>{{admission_fee}}</td></tr>{{/if}}{{#if tuition_term}}<tr><td>Tuition per term (the school invoices this each term)</td><td>{{tuition_term}}</td></tr>{{/if}}{{#if tuition_annual}}<tr><td>Tuition per year (the school invoices this)</td><td>{{tuition_annual}}</td></tr>{{/if}}<tr><td><strong>Total to pay now</strong></td><td><strong>{{amount_due}}</strong></td></tr></table>{{#if conditions}}<p><strong>Conditions:</strong> {{conditions}}</p>{{/if}}{{#if bank_details}}<p><strong>Account details:</strong> {{bank_details}}. Please use the reference {{application_reference}} when you pay. Then send proof of payment to the admissions office.</p>{{/if}}<p>Please tell the school office if your contact details change. Then you will receive all our messages.</p><p>We will email you everything you need before {{intake}} starts.</p><p>This offer is open until <strong>{{offer_expiry_date}}</strong>. Reference: {{application_reference}}.</p><p>We look forward to welcoming {{student_first_name}} to the Hibiscus family.</p><p>Kind regards,<br>Admissions, Hibiscus International Schools</p>$body$,
  $terms$<h2>Terms</h2><p>Your child's place is secured when you have paid the application and admission fees in full, or when the school has waived them under a written offer. These fees are in {{currency}}. They are not refundable. The school invoices tuition each term, following its published fee schedule and payment options. Admission follows the school's policies. The parent or guardian accepts these policies at registration.</p>$terms$,
  (select array_agg(distinct v) from unnest(
     (select t.allowed_variables from public.offer_templates t where t.key = 'standard' order by t.version desc limit 1)
     || array['promotion_name', 'promotion_lines', 'promotion_text', 'promotion_savings']
   ) as v),
  true
from public.offer_templates where key = 'standard';

-- Results-and-offer email: names the welcome offer in one sentence.
do $$
declare v_next int;
begin
  select max(version) + 1 into v_next from public.email_templates where key = 'results_and_offer';
  update public.email_templates set is_active = false where key = 'results_and_offer' and is_active;
  insert into public.email_templates (key, version, name, description, subject, body_html, body_text, allowed_variables, is_active, audience)
  select key, v_next, name, description, subject,
    '<p>Dear {{parent_first_name}},</p><p>Thank you for bringing {{student_first_name}} to be assessed.</p><p>{{student_first_name}}''s learning profile is now ready. It shows strengths and areas to develop, and it is yours to keep.</p><p><a href="{{results_link}}" class="button">View learning profile</a></p><p>We are also happy to offer <strong>{{student_first_name}}</strong> a place at <strong>{{campus}}</strong> in <strong>{{grade}}</strong>.</p>{{#if promotion_text}}<p><strong>Your welcome offer:</strong> {{promotion_text}}.</p>{{/if}}<p><a href="{{offer_link}}" class="button">View the offer</a></p><p>The offer is open until <strong>{{offer_expiry_date}}</strong>.{{#if amount_due}} The fees to pay when you accept are {{amount_due}}.{{/if}}</p><p>Reference: {{application_reference}}</p><p>Warm regards,<br>Hibiscus International Schools Admissions</p>',
    E'Dear {{parent_first_name}},\n\nThank you for bringing {{student_first_name}} to be assessed.\n\n{{student_first_name}}''s learning profile is now ready. It shows strengths and areas to develop, and it is yours to keep:\n{{results_link}}\n\nWe are also happy to offer {{student_first_name}} a place at {{campus}} in {{grade}}.\n\n{{#if promotion_text}}Your welcome offer: {{promotion_text}}.\n\n{{/if}}Please view the offer here:\n{{offer_link}}\n\nThe offer is open until {{offer_expiry_date}}.{{#if amount_due}} The fees to pay when you accept are {{amount_due}}.{{/if}}\n\nReference: {{application_reference}}\n\nWarm regards,\nHibiscus International Schools Admissions',
    (select array_agg(distinct v) from unnest(allowed_variables || array['promotion_text']) as v),
    true, audience
    from public.email_templates where key = 'results_and_offer' order by version desc limit 1;
end $$;

-- A new email for the case where the deal waived everything: the place is
-- secured without a payment, and registration opens at once.
insert into public.email_templates (key, version, name, description, subject, body_html, body_text, allowed_variables, is_active, audience)
select 'fees_waived', 1, 'Fees waived: place secured',
  'Sent instead of the payment receipt when a promotion waived every fee payable on acceptance.',
  '{{student_first_name}}''s place is secured',
  '<p>Dear {{parent_first_name}},</p><p>Thank you for accepting the offer. {{student_first_name}}''s place at {{campus}} in {{grade}} is now secured.</p><p>Under our welcome offer, no fees are due now: {{promotion_text}}.</p><p>The last step is registration. This is the information the school needs before {{student_first_name}} starts. We already have the details you gave us earlier, so it is quick.</p><p><a href="{{registration_link}}" class="button">Complete registration</a></p><p>Reference: {{application_reference}}</p><p>Warm regards,<br>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\nThank you for accepting the offer. {{student_first_name}}''s place at {{campus}} in {{grade}} is now secured.\n\nUnder our welcome offer, no fees are due now: {{promotion_text}}.\n\nThe last step is registration. This is the information the school needs before {{student_first_name}} starts. We already have the details you gave us earlier, so it is quick.\n\nComplete registration here:\n{{registration_link}}\n\nReference: {{application_reference}}\n\nWarm regards,\nHibiscus International Schools Admissions',
  array['parent_first_name','student_first_name','campus','grade','application_reference','promotion_text','registration_link','next_step_link'],
  true, 'parent'
where not exists (select 1 from public.email_templates where key = 'fees_waived');
