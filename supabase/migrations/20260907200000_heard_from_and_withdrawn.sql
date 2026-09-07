-- ---------------------------------------------------------------------------
-- "How did you hear about us?" and two more pipeline counts
-- ---------------------------------------------------------------------------
--
-- `applications.source` records the door the application came through
-- (website, staff, walk-in). It says nothing about the advertising that
-- brought the parent to the door. `heard_from` does: a fixed list the parent
-- picks from on every interest form (assessment, visit, call), with a free
-- line when they choose "other". The wording lives in code
-- (web/lib/heard-from.ts); the keys live here.
--
-- The dashboard also learns to count visits booked and applications
-- withdrawn, so both stages are visible without opening the applicants list.

alter table public.applications
  add column if not exists heard_from text,
  add column if not exists heard_from_detail text;

alter table public.applications drop constraint if exists applications_heard_from_check;
alter table public.applications add constraint applications_heard_from_check check (
  heard_from is null or heard_from in (
    'search', 'social_media', 'friend_family', 'current_parent', 'school_event',
    'radio_print', 'signage', 'other'
  )
);

alter table public.applications drop constraint if exists applications_heard_from_detail_check;
alter table public.applications add constraint applications_heard_from_detail_check
  check (heard_from_detail is null or length(heard_from_detail) <= 120);

-- ---------------------------------------------------------------------------
-- create_application: two more optional parameters
-- ---------------------------------------------------------------------------

drop function if exists public.create_application(
  text, text, text, text, text, text, text, text, date, uuid, uuid, uuid, uuid, text, text, text, text
);

create or replace function public.create_application(
  p_parent_first_name text,
  p_parent_last_name text,
  p_email text,
  p_email_normalised text,
  p_mobile text,
  p_mobile_normalised text,
  p_child_first_name text,
  p_child_last_name text,
  p_child_date_of_birth date,
  p_campus_id uuid,
  p_grade_id uuid,
  p_recommended_grade_id uuid,
  p_intake_id uuid,
  p_entry_route text,
  p_source text default 'website',
  p_current_school text default null,
  p_current_grade text default null,
  p_heard_from text default null,
  p_heard_from_detail text default null
)
returns table (application_id uuid, reference text, contact_id uuid, created boolean)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_contact_id uuid;
  v_application_id uuid;
  v_reference text;
  v_requires boolean;
begin
  insert into public.contacts (first_name, last_name, email, email_normalised, mobile, mobile_normalised)
  values (
    p_parent_first_name, p_parent_last_name, p_email, p_email_normalised,
    p_mobile, p_mobile_normalised
  )
  on conflict (email_normalised) do update
    set first_name = excluded.first_name,
        last_name = excluded.last_name,
        email = excluded.email,
        -- A newly supplied number replaces the old; a blank does not erase it.
        mobile = coalesce(excluded.mobile, public.contacts.mobile),
        mobile_normalised = coalesce(excluded.mobile_normalised, public.contacts.mobile_normalised)
  returning id into v_contact_id;

  select a.id, a.reference into v_application_id, v_reference
    from public.applications a
   where a.contact_id = v_contact_id
     and lower(a.child_first_name) = lower(p_child_first_name)
     and lower(a.child_last_name) = lower(p_child_last_name)
     and a.child_date_of_birth = p_child_date_of_birth
     and a.intake_id = p_intake_id
     and a.status <> 'withdrawn'
   limit 1;

  if v_application_id is not null then
    -- A returning parent who now tells us how they heard of the school
    -- fills the blank; an answer already given is kept.
    if p_heard_from is not null then
      update public.applications
         set heard_from = p_heard_from,
             heard_from_detail = nullif(p_heard_from_detail, '')
       where id = v_application_id and heard_from is null;
    end if;
    return query select v_application_id, v_reference, v_contact_id, false;
    return;
  end if;

  select g.requires_assessment into v_requires from public.grades g where g.id = p_grade_id;
  if v_requires is null then
    raise exception 'grade_not_found';
  end if;

  v_reference := public.next_application_reference();

  insert into public.applications (
    reference, contact_id, child_first_name, child_last_name, child_date_of_birth,
    campus_id, grade_id, recommended_grade_id, intake_id, requires_assessment,
    entry_route, source, current_school, current_grade, heard_from, heard_from_detail
  ) values (
    v_reference, v_contact_id, p_child_first_name, p_child_last_name, p_child_date_of_birth,
    p_campus_id, p_grade_id, p_recommended_grade_id, p_intake_id, v_requires,
    p_entry_route, p_source, p_current_school, p_current_grade,
    p_heard_from, nullif(p_heard_from_detail, '')
  )
  returning id into v_application_id;

  insert into public.application_guardians (application_id, contact_id, relationship, is_primary)
  values (v_application_id, v_contact_id, 'parent', true);

  return query select v_application_id, v_reference, v_contact_id, true;
end;
$$;

revoke execute on function public.create_application(
  text, text, text, text, text, text, text, text, date, uuid, uuid, uuid, uuid, text, text, text, text, text, text
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- v_application_facts: + heard_from (appended; a view can only grow at the end)
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
  a.heard_from
from public.v_application_milestones m
join public.campuses c on c.id = m.campus_id
join public.grades g on g.id = m.grade_id
join public.intakes i on i.id = m.intake_id
left join public.registrations r on r.application_id = m.application_id
left join public.applications a on a.id = m.application_id;

-- ---------------------------------------------------------------------------
-- dashboard_counts: + visits_booked, + withdrawn
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
      (select count(*) from public.tasks where status = 'open' and type = 'parent_replied'),
    'visits_booked',
      (select count(*) from public.applications where status = 'visit_booked'),
    'withdrawn',
      (select count(*) from public.applications where status = 'withdrawn')
  )
$$;

revoke execute on function public.dashboard_counts() from public, anon;
grant execute on function public.dashboard_counts() to authenticated;
