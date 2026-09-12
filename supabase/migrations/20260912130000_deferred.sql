-- "Not now — talk to us later in the year."
--
-- A family comes to see the school, likes it, and asks to be contacted nearer
-- the time. Until now the only closing move was Withdraw, which is terminal
-- and reads as "they said no". So either the application sat in
-- `awaiting_decision` for months, counted every day as work nobody had done,
-- or it was withdrawn and the family was never heard from again.
--
-- Deferred is neither. It carries the date the family named, it is reversible
-- in one click, and two follow-ups go out around that date before a person is
-- asked to ring them.
--
-- It is also the first real addition to the status list, which was written
-- with every phase's statuses in it so that "a later phase adds code, not a
-- constraint change" (20260904120200_applications.sql). That was true for four
-- phases. This one is a status nobody had thought of, so the comment there is
-- now out of date and this migration is the reason.

-- ---------------------------------------------------------------------------
-- The status
-- ---------------------------------------------------------------------------

alter table public.applications drop constraint if exists applications_status_check;
alter table public.applications add constraint applications_status_check check (status in (
  'new_enquiry',
  'visit_booked',
  'callback_requested',
  'assessment_booked',
  'no_show',
  'assessment_in_progress',
  'assessment_completed',
  'awaiting_decision',
  'staff_review',
  -- Paused at the family's request, with a date to come back to. Not
  -- terminal: `deferred` leads back to `awaiting_decision`.
  'deferred',
  'approved',
  'waitlisted',
  'declined',
  'offer_draft',
  'offer_pending_approval',
  'offer_sent',
  'offer_expired',
  'offer_declined',
  'offer_accepted',
  'payment_required',
  'payment_processing',
  'paid',
  'registration_incomplete',
  'registration_complete',
  'enrolled',
  'withdrawn'
));

alter table public.applications
  add column if not exists deferred_until date,
  add column if not exists deferred_reason text;

comment on column public.applications.deferred_until is
  'The date the family asked to be contacted again. Drives the two follow-ups and the task to ring them. Null unless the application is, or has been, deferred.';
comment on column public.applications.deferred_reason is
  'What the family said, in the words of whoever spoke to them. Free text on purpose: this is a note, not a category.';

-- The question the console asks: who is due back? Partial, because a deferred
-- application is a small minority and every other status has a null date.
create index if not exists applications_deferred_due_idx
  on public.applications(deferred_until)
  where status = 'deferred';

-- ---------------------------------------------------------------------------
-- Why a family said no
-- ---------------------------------------------------------------------------

-- `withdrawn_reason` stays as the note in somebody's own words. The code
-- beside it is what turns "why do we lose families" into a number: free text
-- cannot be grouped, and a school that cannot see "fees: 40%" cannot act on
-- it. Nullable, because every application withdrawn before today has a reason
-- written but no code, and inventing one for them would be making data up.
alter table public.applications
  add column if not exists withdrawn_reason_code text;

alter table public.applications drop constraint if exists applications_withdrawn_reason_code_check;
alter table public.applications add constraint applications_withdrawn_reason_code_check
  check (withdrawn_reason_code is null or withdrawn_reason_code in (
    'another_school',
    'fees',
    'moving_away',
    'changed_mind',
    'no_longer_needed',
    'other'
  ));

comment on column public.applications.withdrawn_reason_code is
  'Why the family withdrew, from a short list, for the analytics. Null for anything withdrawn before the list existed, and for a withdrawal the system made itself.';

-- ---------------------------------------------------------------------------
-- The follow-up
-- ---------------------------------------------------------------------------

insert into public.email_templates (key, version, name, description, subject, body_html, body_text, allowed_variables, is_active, audience)
values (
  'deferred_follow_up',
  1,
  'Following up as asked',
  'Sent around the date a deferred family asked to be contacted again. Sent twice at most, and never once they are no longer deferred.',
  'Following up about {{student_first_name}}''s place at {{campus}}',
  '<p>Dear {{parent_first_name}},</p><p>When we last spoke you asked us to get in touch about a place for <strong>{{student_first_name}}</strong> at <strong>{{campus}}</strong> around now.</p><p>Is this still a good time? If it is, tap below and we will pick up where we left off. If your plans have changed, tell us and we will close the enquiry — either answer is a help to us.</p><p><a href="{{next_step_link}}" class="button">Talk to us</a></p><p>You can also reply to this email{{#if campus_whatsapp}}, or message us on {{campus_whatsapp}}{{/if}}.</p><p>Reference: {{application_reference}}</p><p>Warm regards,<br>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\nWhen we last spoke you asked us to get in touch about a place for {{student_first_name}} at {{campus}} around now.\n\nIs this still a good time? If it is, follow the link below and we will pick up where we left off. If your plans have changed, tell us and we will close the enquiry — either answer is a help to us.\n\n{{next_step_link}}\n\nYou can also reply to this email{{#if campus_whatsapp}}, or message us on {{campus_whatsapp}}{{/if}}.\n\nReference: {{application_reference}}\n\nWarm regards,\nHibiscus International Schools Admissions',
  array['parent_first_name','student_first_name','campus','grade','application_reference','next_step_link','campus_whatsapp'],
  true,
  'parent'
)
on conflict (key, version) do nothing;

-- Inactive with no provider id until Zavu approves the wording and somebody
-- pastes the id in; until then the follow-up goes by email alone.
--
-- It names the campus's own number rather than inviting a reply: the number
-- these go out from is not manned, and a family answering into it would be
-- answering nobody. Potch is a South African number and every Botswana campus
-- shares another, so it is a variable.
insert into public.message_templates (key, name, language, body_preview, parameters, button_link, link_purpose, is_active, audience)
values (
  'deferred_follow_up',
  'Following up as asked',
  'en',
  E'Hi {{1}}, you asked us to get in touch about {{2}}''s place at {{3}} around now. Is this still a good time? Tap below to tell us, or message us on {{4}} and we will answer there.',
  array['parent_first_name','student_first_name','campus','campus_whatsapp'],
  true,
  'next_step',
  false,
  'applicant'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- The facts view learns both columns
-- ---------------------------------------------------------------------------

-- Recreated whole, as every change to it has been. `deferred_until` answers
-- "how many are due back this term"; `withdrawn_reason_code` is the column
-- the withdrawal breakdown groups on.
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
  pr.name as promotion_name,
  -- Appended rather than slotted in beside `heard_from`, where they read more
  -- naturally: `create or replace view` may add columns at the end and may not
  -- rename the ones already there, and dropping the view to make it tidy would
  -- take its grants with it.
  a.deferred_until,
  a.withdrawn_reason_code
from public.v_application_milestones m
join public.campuses c on c.id = m.campus_id
join public.grades g on g.id = m.grade_id
join public.intakes i on i.id = m.intake_id
left join public.registrations r on r.application_id = m.application_id
left join public.applications a on a.id = m.application_id
left join public.application_promotions ap on ap.application_id = m.application_id
left join public.promotions pr on pr.id = ap.promotion_id;
