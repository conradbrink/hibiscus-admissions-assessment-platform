-- Enrolment: the snapshot that goes to the school's student system, the
-- dashboard's Phase 3 queues, and the welcome email.
--
-- The student record is a frozen copy of what registration collected,
-- generated when a person confirms enrolment (or the auto_enrol switch
-- does). The student management system is behind an interface with a
-- "none" implementation; a record waits as `pending` until one exists.

create table if not exists public.student_records (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade unique,
  schema_version int not null default 1,
  -- {application, student, guardians, emergency_contacts, medical, documents, agreements, payment}
  snapshot jsonb not null,
  generated_at timestamptz not null default now(),
  generated_by uuid references public.staff_profiles(id) on delete set null,
  export_status text not null default 'pending' check (export_status in ('pending', 'exported', 'failed')),
  exported_at timestamptz,
  external_ref text,
  export_error text,
  created_at timestamptz not null default now()
);

alter table public.student_records enable row level security;

-- Read with the application; written by the engine at enrolment. No staff
-- write: a correction regenerates the record through the engine.
drop policy if exists student_records_select on public.student_records;
create policy student_records_select on public.student_records
  for select using (
    exists (
      select 1 from public.applications a
      where a.id = student_records.application_id
        and (select public.has_permission('applications.read'))
        and (select public.can_access_campus(a.campus_id))
    )
  );

-- ---------------------------------------------------------------------------
-- dashboard_counts(): the Phase 3 queues join the tiles. Same signature,
-- still security invoker, so a campus-restricted person counts their own.
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
      (select count(*) from public.tasks where status = 'open' and assignee_staff_id = auth.uid())
  )
$$;

revoke execute on function public.dashboard_counts() from public, anon;
grant execute on function public.dashboard_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- The welcome email
-- ---------------------------------------------------------------------------

insert into public.email_templates (key, name, description, subject, body_text, body_html, allowed_variables)
values
(
  'welcome_enrolled',
  'Welcome to Hibiscus Schools',
  'Sent when enrolment is confirmed. The last email of the admissions journey.',
  'Welcome to Hibiscus Schools, {{student_first_name}}!',
  E'Dear {{parent_first_name}},\n\nWe are delighted to confirm that {{student_first_name}} {{student_last_name}} is enrolled at {{campus}} in {{grade}}, starting {{start_date}}.\n\nRegistration is complete and there is nothing more you need to do. The school will be in touch before the first day with the practical details: uniform, stationery, times and who to ask for.\n\nThank you for choosing Hibiscus Schools. We look forward to welcoming {{student_first_name}}.\n\nReference: {{application_reference}}\n\nWarm regards,\nHibiscus Schools',
  '<p>Dear {{parent_first_name}},</p><p>We are delighted to confirm that <strong>{{student_first_name}} {{student_last_name}}</strong> is enrolled at <strong>{{campus}}</strong> in <strong>{{grade}}</strong>, starting <strong>{{start_date}}</strong>.</p><p>Registration is complete and there is nothing more you need to do. The school will be in touch before the first day with the practical details: uniform, stationery, times and who to ask for.</p><p>Thank you for choosing Hibiscus Schools. We look forward to welcoming {{student_first_name}}.</p><p>Reference: {{application_reference}}</p><p>Warm regards,<br>Hibiscus Schools</p>',
  array['parent_first_name','student_first_name','student_last_name','campus','grade','start_date','application_reference','next_step_link']
)
on conflict (key, version) do nothing;
