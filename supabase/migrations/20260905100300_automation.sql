-- Automation: waitlist promotion, data retention, the daily staff digest,
-- and the pieces the self-service rebooking flow was missing.
--
-- Every automation is behind a setting that defaults to off, runs from the
-- cron drain, and is idempotent. Retention is the one that destroys data,
-- so it goes through one function, previews before it runs, and honours a
-- hold; analytics rows (status, dates, campus, grade) survive it.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.applications
  add column if not exists anonymised_at timestamptz,
  add column if not exists retention_hold boolean not null default false,
  add column if not exists retention_hold_reason text;

comment on column public.applications.retention_hold is
  'Excluded from retention anonymisation until cleared: a dispute, a legal request, a sibling still applying.';

alter table public.staff_profiles
  add column if not exists digest_enabled boolean not null default true;

alter table public.email_messages
  add column if not exists recipient_staff_id uuid references public.staff_profiles(id) on delete set null;
create index if not exists email_messages_recipient_staff_idx
  on public.email_messages(recipient_staff_id) where recipient_staff_id is not null;

alter table public.email_templates
  add column if not exists audience text not null default 'parent' check (audience in ('parent', 'staff'));

-- The last run of each daily housekeeping job, so the drain (every five
-- minutes) runs it once a day.
create table if not exists public.maintenance_runs (
  key text primary key,
  last_run_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb
);
alter table public.maintenance_runs enable row level security;
-- Service role only: no policies.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

insert into public.settings (key, value, description)
values
  ('waitlist_auto_promote', 'false'::jsonb,
   'When a place opens for a grade at a campus, move the longest-waiting waitlisted applicant to approved automatically (the offer still needs approval). Off: a task asks a person to decide.'),
  ('retention_enabled', 'false'::jsonb,
   'Anonymise abandoned and closed applications after the retention periods below. Preview and holds are under Set up → Data retention.'),
  ('retention_days_abandoned', '180'::jsonb,
   'Days without a status change after which an enquiry that never progressed (new enquiry, callback requested, missed assessment) is anonymised.'),
  ('retention_days_closed', '365'::jsonb,
   'Days after which a closed application (declined, withdrawn, offer declined or expired) is anonymised.'),
  ('digest_enabled', 'false'::jsonb,
   'Email every campus team one morning digest of what needs attention today.'),
  ('digest_hour', '7'::jsonb,
   'The hour (Gaborone time, 0–23) after which the daily digest is sent.'),
  ('reschedule_cutoff_hours', '24'::jsonb,
   'Inside this many hours before an assessment a parent can no longer change or cancel the booking online; the page asks them to call.'),
  ('rebook_nudge_days', '3'::jsonb,
   'Days after a missed or cancelled assessment before the parent is reminded to choose a new time, if they have not.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Templates: the rebooking gaps and the digest
-- ---------------------------------------------------------------------------

insert into public.email_templates (key, name, description, subject, body_text, body_html, allowed_variables, audience)
values
(
  'booking_cancelled',
  'Booking cancelled',
  'Sent when an assessment or visit booking is cancelled without a new time being chosen.',
  '{{student_first_name}}''s booking has been cancelled',
  E'Dear {{parent_first_name}},\n\nThe booking for {{student_first_name}} at {{campus}} has been cancelled. Your enquiry stays open, and you can choose a new date and time whenever suits you:\n\n{{next_step_link}}\n\nReference: {{application_reference}}\n\nKind regards,\nHibiscus Schools Admissions',
  '<p>Dear {{parent_first_name}},</p><p>The booking for <strong>{{student_first_name}}</strong> at {{campus}} has been cancelled. Your enquiry stays open, and you can choose a new date and time whenever suits you.</p><p><a href="{{next_step_link}}" class="button">Choose a new time</a></p><p>Reference: {{application_reference}}</p><p>Kind regards,<br>Hibiscus Schools Admissions</p>',
  array['parent_first_name','student_first_name','campus','application_reference','next_step_link'],
  'parent'
),
(
  'rebook_nudge',
  'Still to rebook',
  'Sent a few days after a missed or cancelled assessment when no new booking has been made.',
  'Choose a new assessment time for {{student_first_name}}',
  E'Dear {{parent_first_name}},\n\n{{student_first_name}} does not yet have a new assessment time at {{campus}}. It takes a minute to choose one:\n\n{{next_step_link}}\n\nIf you have decided not to go ahead, you can ignore this email.\n\nReference: {{application_reference}}\n\nKind regards,\nHibiscus Schools Admissions',
  '<p>Dear {{parent_first_name}},</p><p><strong>{{student_first_name}}</strong> does not yet have a new assessment time at {{campus}}. It takes a minute to choose one.</p><p><a href="{{next_step_link}}" class="button">Choose a time</a></p><p>If you have decided not to go ahead, you can ignore this email.</p><p>Reference: {{application_reference}}</p><p>Kind regards,<br>Hibiscus Schools Admissions</p>',
  array['parent_first_name','student_first_name','campus','application_reference','next_step_link'],
  'parent'
),
(
  'staff_digest',
  'Morning digest (staff)',
  'One email per campus team each morning with what needs attention. No links to applicants: the console is the place.',
  '{{campus}} admissions today, {{date}}',
  E'Good morning {{staff_first_name}},\n\n{{campus}}, {{date}}:\n\nAssessments today: {{assessments_today}}\nAwaiting marking: {{awaiting_marking}}\nTasks overdue: {{tasks_overdue}}\nOffers to approve: {{offers_to_approve}}\nOffers expiring within 3 days: {{offers_expiring}}\nPayments overdue: {{payments_overdue}}\nParents missing documents: {{documents_missing}}\nEnrolments to confirm: {{enrolments_to_confirm}}\nWaitlist places available: {{waitlist_places}}\nParents who replied on WhatsApp: {{parent_replies}}\n\nOpen the console: {{console_link}}\n\nHibiscus Admissions',
  '<p>Good morning {{staff_first_name}},</p><p><strong>{{campus}}</strong>, {{date}}:</p><table cellpadding="4"><tr><td>Assessments today</td><td><strong>{{assessments_today}}</strong></td></tr><tr><td>Awaiting marking</td><td><strong>{{awaiting_marking}}</strong></td></tr><tr><td>Tasks overdue</td><td><strong>{{tasks_overdue}}</strong></td></tr><tr><td>Offers to approve</td><td><strong>{{offers_to_approve}}</strong></td></tr><tr><td>Offers expiring within 3 days</td><td><strong>{{offers_expiring}}</strong></td></tr><tr><td>Payments overdue</td><td><strong>{{payments_overdue}}</strong></td></tr><tr><td>Parents missing documents</td><td><strong>{{documents_missing}}</strong></td></tr><tr><td>Enrolments to confirm</td><td><strong>{{enrolments_to_confirm}}</strong></td></tr><tr><td>Waitlist places available</td><td><strong>{{waitlist_places}}</strong></td></tr><tr><td>Parents who replied on WhatsApp</td><td><strong>{{parent_replies}}</strong></td></tr></table><p><a href="{{console_link}}" class="button">Open the console</a></p><p>Hibiscus Admissions</p>',
  array['staff_first_name','campus','date','assessments_today','awaiting_marking','tasks_overdue','offers_to_approve','offers_expiring','payments_overdue','documents_missing','enrolments_to_confirm','waitlist_places','parent_replies','console_link'],
  'staff'
)
on conflict (key, version) do nothing;

-- The WhatsApp companions of the two rebooking emails, inactive until approved.
insert into public.message_templates (key, name, body_preview, parameters, button_link, link_purpose)
values
  ('booking_cancelled', 'Booking cancelled',
   E'Hi {{1}}, {{2}}''s booking at {{3}} has been cancelled. Tap below to choose a new time whenever suits you.',
   array['parent_first_name','student_first_name','campus'], true, 'next_step'),
  ('rebook_nudge', 'Still to rebook',
   E'Hi {{1}}, {{2}} does not have a new assessment time yet. Tap below to choose one.',
   array['parent_first_name','student_first_name'], true, 'next_step')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Anonymisation: the one function that removes personal data
-- ---------------------------------------------------------------------------

create or replace function public.anonymise_application(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact uuid;
  v_others int;
begin
  select contact_id into v_contact from public.applications where id = p_application_id for update;
  if v_contact is null then
    raise exception 'application_not_found';
  end if;

  -- The application row stays, for the analytics; the child does not.
  update public.applications
     set child_first_name = 'Removed',
         child_last_name = 'Removed',
         child_preferred_name = null,
         child_date_of_birth = date '1900-01-01',
         current_school = null,
         current_grade = null,
         withdrawn_reason = null,
         anonymised_at = now()
   where id = p_application_id;

  -- The contact, if no other live application still needs them.
  select count(*) into v_others
    from public.applications
   where contact_id = v_contact and id <> p_application_id and anonymised_at is null;
  if v_others = 0 then
    update public.contacts
       set first_name = 'Removed',
           last_name = 'Removed',
           email = 'removed+' || v_contact::text || '@invalid',
           email_normalised = 'removed+' || v_contact::text || '@invalid',
           mobile = null,
           mobile_normalised = null,
           whatsapp_opt_in = false
     where id = v_contact;
  end if;

  delete from public.application_guardians where application_id = p_application_id;
  delete from public.registration_contacts where application_id = p_application_id;
  delete from public.agreement_acceptances where application_id = p_application_id;
  delete from public.registrations where application_id = p_application_id;
  delete from public.documents where application_id = p_application_id;
  delete from public.notes where application_id = p_application_id;
  delete from public.student_records where application_id = p_application_id;
  delete from public.application_summaries where application_id = p_application_id;
  delete from public.token_uses where token_id in (select id from public.access_tokens where application_id = p_application_id);
  delete from public.access_tokens where application_id = p_application_id;
  update public.callback_requests set preferred_time = null, message = null where application_id = p_application_id;

  update public.email_messages
     set to_email = 'removed', subject = 'Removed', body_html = '', body_text = '', error = null
   where application_id = p_application_id;
  update public.messages
     set rendered_text = '', to_normalised = null, from_normalised = null, error = null
   where application_id = p_application_id;

  update public.attempt_responses
     set response = jsonb_build_object('removed', true)
   where attempt_id in (select id from public.attempts where application_id = p_application_id);
  update public.attempts set device_user_agent = null where application_id = p_application_id;
  update public.learning_profiles
     set narrative = jsonb_build_object('removed', true)
   where application_id = p_application_id;

  update public.offers
     set rendered_html = '<p>Removed</p>', variables = '{}'::jsonb
   where application_id = p_application_id;
  update public.offer_acceptances set ip_hash = null, user_agent = null, decline_reason = null where application_id = p_application_id;
  update public.payments set raw_response = null, note = null, refund_note = null where application_id = p_application_id;

  update public.application_events
     set summary = 'Removed', payload = '{}'::jsonb
   where application_id = p_application_id;
  update public.audit_log
     set before = null, after = null, ip_hash = null
   where application_id = p_application_id;
end;
$$;

revoke execute on function public.anonymise_application(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Per-campus counts for the digest (service role only)
-- ---------------------------------------------------------------------------

create or replace function public.campus_dashboard_counts(p_campus_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with today as (
    select (now() at time zone 'Africa/Gaborone')::date as d
  )
  select jsonb_build_object(
    'assessments_today',
      (select count(*)
         from public.bookings b
         join public.sessions s on s.id = b.session_id
        where s.campus_id = p_campus_id
          and b.kind = 'assessment'
          and b.status in ('booked', 'checked_in', 'in_progress', 'completed')
          and (s.starts_at at time zone 'Africa/Gaborone')::date = (select d from today)),
    'awaiting_marking',
      (select count(*) from public.attempts t join public.applications a on a.id = t.application_id
        where a.campus_id = p_campus_id and t.status = 'submitted' and t.marking_status in ('pending', 'awaiting_rubric')),
    'no_shows_unresolved',
      (select count(*) from public.applications where campus_id = p_campus_id and status = 'no_show'),
    'unbooked_over_48h',
      (select count(*) from public.applications
        where campus_id = p_campus_id and status = 'new_enquiry' and requires_assessment
          and created_at < now() - interval '48 hours'),
    'tasks_overdue',
      (select count(*) from public.tasks where campus_id = p_campus_id and status = 'open' and due_at < now()),
    'offers_to_approve',
      (select count(*) from public.applications where campus_id = p_campus_id and status = 'offer_pending_approval'),
    'offers_expiring',
      (select count(*) from public.offers o join public.applications a on a.id = o.application_id
        where a.campus_id = p_campus_id and o.status in ('sent', 'viewed') and o.expires_at < now() + interval '3 days'),
    'payments_overdue',
      (select count(*) from public.payment_requests pr join public.applications a on a.id = pr.application_id
        where a.campus_id = p_campus_id and pr.status in ('required', 'failed', 'partially_paid') and pr.due_at < now()),
    'documents_missing',
      (select count(*)
         from public.applications a
         join public.grades g on g.id = a.grade_id
        where a.campus_id = p_campus_id
          and a.status in ('registration_incomplete', 'registration_complete')
          and exists (
            select 1 from public.required_document_codes(g.sort_order) as c(code)
            where not exists (
              select 1 from public.documents d
              where d.application_id = a.id and d.requirement_code = c.code
                and d.superseded_by is null and d.deleted_at is null
                and d.review_status <> 'rejected' and d.scan_status <> 'infected'
            )
          )),
    'enrolments_to_confirm',
      (select count(*) from public.applications where campus_id = p_campus_id and status = 'registration_complete'),
    'waitlist_places',
      (select count(*) from public.tasks where campus_id = p_campus_id and status = 'open' and type = 'waitlist_place_available'),
    'parent_replies',
      (select count(*) from public.tasks where campus_id = p_campus_id and status = 'open' and type = 'parent_replied')
  )
$$;

revoke execute on function public.campus_dashboard_counts(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- dashboard_counts(): two more tiles. Same signature, still security invoker.
-- ---------------------------------------------------------------------------

create or replace function public.dashboard_counts()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with today as (
    select (now() at time zone 'Africa/Gaborone')::date as d
  )
  select jsonb_build_object(
    'new_enquiries',
      (select count(*) from public.applications where status in ('new_enquiry', 'callback_requested')),
    'callbacks_open',
      (select count(*) from public.tasks where status = 'open' and type = 'callback'),
    'assessments_today',
      (select count(*)
         from public.bookings b
         join public.sessions s on s.id = b.session_id
        where b.kind = 'assessment'
          and b.status in ('booked', 'checked_in', 'in_progress', 'completed')
          and (s.starts_at at time zone 'Africa/Gaborone')::date = (select d from today)),
    'assessments_this_week',
      (select count(*)
         from public.bookings b
         join public.sessions s on s.id = b.session_id
        where b.kind = 'assessment'
          and b.status in ('booked', 'checked_in', 'in_progress')
          and s.starts_at >= now()
          and s.starts_at < now() + interval '7 days'),
    'awaiting_marking',
      (select count(*) from public.attempts where status = 'submitted' and marking_status in ('pending', 'awaiting_rubric')),
    'awaiting_decision',
      (select count(*) from public.applications where status in ('awaiting_decision', 'staff_review')),
    'staff_review',
      (select count(*) from public.applications where status = 'staff_review'),
    'no_shows_unresolved',
      (select count(*) from public.applications where status = 'no_show'),
    'unbooked_over_48h',
      (select count(*) from public.applications
        where status = 'new_enquiry' and requires_assessment
          and created_at < now() - interval '48 hours'),
    'offers_to_approve',
      (select count(*) from public.applications where status = 'offer_pending_approval'),
    'offers_blocked',
      (select count(*) from public.applications where status = 'offer_draft'),
    'outcomes_to_send',
      (select count(*) from public.tasks where status = 'open' and type = 'send_outcome'),
    'offers_outstanding',
      (select count(*) from public.applications where status = 'offer_sent'),
    'offers_expiring_3d',
      (select count(*) from public.offers
        where status in ('sent', 'viewed') and expires_at < now() + interval '3 days'),
    'payments_outstanding',
      (select count(*) from public.applications where status in ('payment_required', 'payment_processing')),
    'payments_processing',
      (select count(*) from public.payment_requests where status = 'processing'),
    'payments_failed',
      (select count(*) from public.payment_requests where status = 'failed'),
    'payments_overdue',
      (select count(*) from public.payment_requests
        where status in ('required', 'failed', 'partially_paid') and due_at < now()),
    'registrations_incomplete',
      (select count(*) from public.applications where status = 'registration_incomplete'),
    'documents_missing',
      (select count(*)
         from public.applications a
         join public.grades g on g.id = a.grade_id
        where a.status in ('registration_incomplete', 'registration_complete')
          and exists (
            select 1 from public.required_document_codes(g.sort_order) as c(code)
            where not exists (
              select 1 from public.documents d
              where d.application_id = a.id and d.requirement_code = c.code
                and d.superseded_by is null and d.deleted_at is null
                and d.review_status <> 'rejected' and d.scan_status <> 'infected'
            )
          )),
    'enrolments_to_confirm',
      (select count(*) from public.applications where status = 'registration_complete'),
    'enrolled',
      (select count(*) from public.applications where status = 'enrolled'),
    'tasks_open',
      (select count(*) from public.tasks where status = 'open'),
    'tasks_overdue',
      (select count(*) from public.tasks where status = 'open' and due_at < now()),
    'my_tasks_open',
      (select count(*) from public.tasks where status = 'open' and assignee_staff_id = auth.uid()),
    'waitlist_places',
      (select count(*) from public.tasks where status = 'open' and type = 'waitlist_place_available'),
    'parent_replies',
      (select count(*) from public.tasks where status = 'open' and type = 'parent_replied')
  )
$$;

revoke execute on function public.dashboard_counts() from public, anon;
grant execute on function public.dashboard_counts() to authenticated;
