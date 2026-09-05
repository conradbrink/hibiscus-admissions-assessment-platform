-- Parent-effort instrumentation.
--
-- The project is judged on whether a parent can go from the website to a
-- booked assessment in under three minutes. That claim needs measuring, not
-- asserting. Every step of the funnel writes a row here with the time since
-- the previous step, keyed by an anonymous browser session id that is a
-- random value in a cookie and nothing else.

create table if not exists public.funnel_events (
  id bigint generated always as identity primary key,
  -- Random per browser, set by the funnel on first visit. Not tied to a
  -- person until an application is created, and then only by application_id.
  session_key text not null,
  application_id uuid references public.applications(id) on delete set null,
  step text not null,
  campus_id uuid references public.campuses(id) on delete set null,
  grade_id uuid references public.grades(id) on delete set null,
  -- Milliseconds since the previous step in the same session, as reported by
  -- the browser. Null on the first step.
  elapsed_ms int check (elapsed_ms is null or elapsed_ms >= 0),
  occurred_at timestamptz not null default now()
);

create index if not exists funnel_events_session_idx on public.funnel_events(session_key, id);
create index if not exists funnel_events_step_idx on public.funnel_events(step, occurred_at desc);

alter table public.funnel_events enable row level security;

drop policy if exists funnel_events_select on public.funnel_events;
create policy funnel_events_select on public.funnel_events
  for select using ((select public.has_permission('analytics.read')));

-- Written by the funnel under the service role. No write policies.

-- ---------------------------------------------------------------------------
-- Analytics views
-- ---------------------------------------------------------------------------
--
-- security_invoker so RLS on the underlying tables applies to whoever reads
-- the view. A view defaults to definer rights and would otherwise bypass RLS.

create or replace view public.v_pipeline_counts
with (security_invoker = true)
as
select
  a.campus_id,
  c.name as campus_name,
  a.status,
  count(*)::int as applications
from public.applications a
join public.campuses c on c.id = a.campus_id
group by a.campus_id, c.name, a.status;

-- One row per application with the instant it reached each milestone, taken
-- from the timeline. Conversion and cycle-time reports are queries over this.
create or replace view public.v_application_milestones
with (security_invoker = true)
as
select
  a.id as application_id,
  a.campus_id,
  a.grade_id,
  a.intake_id,
  a.entry_route,
  a.source,
  a.requires_assessment,
  a.status,
  a.created_at as enquired_at,
  min(e.occurred_at) filter (where e.type = 'booking.created')          as booked_at,
  min(e.occurred_at) filter (where e.type = 'booking.checked_in')       as attended_at,
  min(e.occurred_at) filter (where e.type = 'booking.no_show')          as no_show_at,
  min(e.occurred_at) filter (where e.type = 'assessment.completed')     as assessed_at,
  min(e.occurred_at) filter (where e.type = 'decision.made')            as decided_at,
  min(e.occurred_at) filter (where e.type = 'offer.sent')               as offered_at,
  min(e.occurred_at) filter (where e.type = 'offer.accepted')           as accepted_at,
  min(e.occurred_at) filter (where e.type = 'payment.confirmed')        as paid_at,
  min(e.occurred_at) filter (where e.type = 'enrolment.completed')      as enrolled_at
from public.applications a
left join public.application_events e on e.application_id = a.id
group by a.id;

-- Median seconds between the first and last step of each funnel session that
-- reached a booking. The headline parent-effort number.
create or replace view public.v_funnel_effort
with (security_invoker = true)
as
with sessions as (
  select
    session_key,
    min(occurred_at) filter (where step = 'enquiry.started')    as started_at,
    min(occurred_at) filter (where step = 'enquiry.submitted')  as submitted_at,
    min(occurred_at) filter (where step = 'booking.confirmed')  as booked_at
  from public.funnel_events
  group by session_key
)
select
  count(*) filter (where started_at is not null)::int                     as sessions_started,
  count(*) filter (where submitted_at is not null)::int                   as enquiries_submitted,
  count(*) filter (where booked_at is not null)::int                      as bookings_confirmed,
  percentile_cont(0.5) within group (
    order by extract(epoch from (submitted_at - started_at))
  ) filter (where submitted_at is not null)                               as median_seconds_to_enquiry,
  percentile_cont(0.5) within group (
    order by extract(epoch from (booked_at - started_at))
  ) filter (where booked_at is not null)                                  as median_seconds_to_booking,
  percentile_cont(0.9) within group (
    order by extract(epoch from (booked_at - started_at))
  ) filter (where booked_at is not null)                                  as p90_seconds_to_booking
from sessions;
