-- "Enquiries not booked after 48 hours" counts every route, not only the
-- assessment one.
--
-- The count was written when every family booked an assessment, and kept
-- `requires_assessment` after visits and interviews arrived. A family who
-- had to book an interview or a visit and had not was then waiting exactly
-- as long, and invisible: the dashboard said 4, and the New enquiry list it
-- opened held 35, most of them a fortnight old with "Parent to book
-- interview" beside them. The dashboard link now opens the same list
-- narrowed to enquiries older than 48 hours, so the two agree.
--
-- Same signature, still security invoker; only that one key changes.

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
        where status = 'new_enquiry'
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
      (select count(*) from public.tasks where status = 'open' and type = 'parent_replied'),
    'visits_booked',
      (select count(*) from public.applications where status = 'visit_booked'),
    'withdrawn',
      (select count(*) from public.applications where status = 'withdrawn')
  )
$$;

revoke execute on function public.dashboard_counts() from public, anon;
grant execute on function public.dashboard_counts() to authenticated;
