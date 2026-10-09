-- Analytics: check who is asking once per application, not once per row.
--
-- The analytics page has been drawing zeros. Not an empty database — a
-- failed request the page threw away. `v_application_facts` was
-- security_invoker, so row-level security was re-evaluated on every row of
-- every table it touches: three hundred applications, but four and a half
-- thousand `application_events`, and a further pass over `registrations`,
-- `offers`, `payment_requests`, `email_messages`, `messages`,
-- `admission_decisions`, `application_promotions` and `promotions`. Each of
-- those rows ran `has_permission()` and `can_access_campus()` and an index
-- lookup back into `applications`. Measured on production data, one range:
--
--     as `authenticated`, RLS per row   2,440 ms
--     as the owner, no RLS                  37 ms
--
-- Sixty-six times over, for an answer identical to the byte. Two of those
-- queries run together on every page load, so under any real concurrency
-- they passed the `authenticated` role's eight-second statement timeout.
-- PostgREST answered 500; the page read only `data`, never `error`; and
-- every figure rendered as a zero. The page is fixed separately to show the
-- error rather than swallow it — this migration removes the error.
--
-- So the check moves into the view and happens once, against the one thing
-- that governs it: the application. Every table joined here is keyed by
-- application, and every policy on those tables resolves to the same two
-- predicates on the owning application, so filtering the applications is
-- exactly what filtering each joined row was already doing — only once
-- instead of nine times over.
--
-- Two policies are *not* those same two predicates, and both are reproduced
-- here rather than lost:
--
--   * `offers` needs `offers.read`, not `applications.read`. Without it the
--     subquery matched nothing and `offer_status` came back null, so the
--     guard below returns null for exactly the same people.
--   * `payment_requests` needs `offers.read` or `finance.read`, and scopes
--     on the payment request's own campus, which need not be the
--     application's. Without it the sum was over no rows, which is zero, so
--     the guard returns zero for the same people, and still asks about the
--     payment request's own campus.
--
-- `campuses`, `grades` and `intakes` ask only that the reader be active
-- staff, which `has_permission` already requires of everyone who gets this
-- far, and they are joined on ids that reached here through an application.
--
-- Verified against production before and after, as four staff with
-- different scopes, comparing the row count and an md5 over every column of
-- every row: the super administrator (306 rows), finance (306), and two
-- campus administrators (92 and 39). Identical in all four cases.

create or replace view public.v_application_milestones
with (security_invoker = false)
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
  min(e.occurred_at) filter (where e.type = 'booking.created') as booked_at,
  min(e.occurred_at) filter (where e.type = 'booking.checked_in') as attended_at,
  min(e.occurred_at) filter (where e.type = 'booking.no_show') as no_show_at,
  min(e.occurred_at) filter (where e.type = 'assessment.completed') as assessed_at,
  min(e.occurred_at) filter (where e.type = 'decision.made') as decided_at,
  min(e.occurred_at) filter (where e.type = 'offer.sent') as offered_at,
  min(e.occurred_at) filter (where e.type = 'offer.accepted') as accepted_at,
  min(e.occurred_at) filter (where e.type = 'payment.confirmed') as paid_at,
  min(e.occurred_at) filter (where e.type = 'enrolment.completed') as enrolled_at
from public.applications a
left join public.application_events e on e.application_id = a.id
-- The whole access check, in one place: the two predicates the
-- `applications_select` policy applies, and the two that every policy on the
-- tables joined below resolves to.
where public.has_permission('applications.read')
  and public.can_access_campus(a.campus_id)
group by a.id;

create or replace view public.v_application_facts
with (security_invoker = false)
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
  (select min(ev.occurred_at)
     from public.application_events ev
    where ev.application_id = m.application_id
      and ev.type = 'application.withdrawn') as withdrawn_at,
  (select d.final_outcome
     from public.admission_decisions d
    where d.application_id = m.application_id
      and d.final_outcome <> 'staff_review'
    order by d.decided_at desc
    limit 1) as decision_outcome,
  -- `offers` asks for `offers.read`, which not everyone who may read an
  -- application holds. Null for them, as before.
  case when public.has_permission('offers.read') then
    (select o.status
       from public.offers o
      where o.application_id = m.application_id
      order by o.created_at desc
      limit 1)
  end as offer_status,
  -- `payment_requests` asks for `offers.read` or `finance.read`, and scopes
  -- on its own campus rather than the application's. Zero for anyone else,
  -- as before.
  (case when public.has_permission('offers.read') or public.has_permission('finance.read') then
    (select coalesce(sum(pr_1.paid_minor), 0)
       from public.payment_requests pr_1
      where pr_1.application_id = m.application_id
        and public.can_access_campus(pr_1.campus_id))
   else 0 end)::bigint as paid_minor,
  (select count(*)
     from public.email_messages e
    where e.application_id = m.application_id
      and e.status <> 'failed')::integer as emails_sent,
  (select count(*)
     from public.messages x
    where x.application_id = m.application_id
      and x.direction = 'out'
      and x.status = any (array['sent', 'delivered', 'read']))::integer as messages_sent,
  (select count(*)
     from public.application_events ev
    where ev.application_id = m.application_id
      and ev.type = 'booking.no_show')::integer as no_show_count,
  coalesce(r.prefilled_count, 0) as prefilled_count,
  coalesce(r.prefill_changed_count, 0) as prefill_changed_count,
  r.submitted_at is not null as registration_submitted,
  a.heard_from,
  pr.code as promotion_code,
  pr.name as promotion_name,
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

grant select on public.v_application_milestones to authenticated;
grant select on public.v_application_facts to authenticated;
