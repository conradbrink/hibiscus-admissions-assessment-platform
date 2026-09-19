-- The Families list and the CRM dashboard were timing out.
--
-- `v_crm_family_facts` counted a family's open tasks with a lateral join
-- that walked every open task once per family and, for each task with an
-- application, called `crm_family_of_application()` to find out whose it
-- was. Under a person that function runs the caller's policies on
-- `applications` and `contacts` every time, so the cost was families ×
-- open tasks × three policy checks: with 45 visible families and 34 open
-- tasks it was 6.5 seconds, and the API's 8-second statement timeout was
-- reached as soon as the page asked for the count as well. Every screen
-- that reads the view (the list, the dashboard, segments, campaign
-- recipient counts) waited for it.
--
-- The tasks are now grouped by family once, in a plain subquery the
-- planner computes a single time and joins by family id. A task belongs to
-- the family of its child, or failing that the family of its application's
-- contact. Same numbers, same policies (the view is still security
-- invoker, so the caller sees only the tasks, children, applications and
-- contacts their own policies allow), a fraction of the work: the same
-- query runs in under 200 ms.
--
-- The rest of the view is unchanged; `create or replace view` needs the
-- whole definition.

create or replace view public.v_crm_family_facts
with (security_invoker = true)
as
select
  f.id as family_id,
  f.family_code,
  f.display_name,
  f.campus_id,
  c.name as campus_name,
  f.lifecycle_stage,
  f.lifecycle_manual,
  f.assigned_staff_id,
  f.lead_source,
  f.tags,
  f.preferred_channel,
  f.last_contact_at,
  f.next_follow_up_at,
  f.created_at,
  f.is_active,
  f.referred_by_family_id,
  pc.id as primary_contact_id,
  pc.first_name as primary_first_name,
  pc.last_name as primary_last_name,
  pc.email as primary_email,
  pc.mobile as primary_mobile,
  pc.mobile_normalised as primary_mobile_normalised,
  pc.whatsapp_opt_in as primary_whatsapp_opt_in,
  pc.marketing_email_consent as primary_marketing_email_consent,
  pc.marketing_whatsapp_consent as primary_marketing_whatsapp_consent,
  pc.sms_consent as primary_sms_consent,
  coalesce(st.student_count, 0)::int as student_count,
  coalesce(st.enrolled_count, 0)::int as enrolled_count,
  coalesce(st.grade_sorts, '{}'::int[]) as grade_sorts,
  coalesce(st.grade_ids, '{}'::uuid[]) as grade_ids,
  coalesce(st.campus_ids, '{}'::uuid[]) as student_campus_ids,
  coalesce(st.student_ids, '{}'::uuid[]) as student_ids,
  coalesce(st.statuses, '{}'::text[]) as student_statuses,
  coalesce(it.codes, '{}'::text[]) as registered_item_codes,
  coalesce(op.types, '{}'::text[]) as open_opportunity_types,
  coalesce(op.n, 0)::int as open_opportunity_count,
  coalesce(re.outstanding, 0)::int as reenrolment_outstanding,
  coalesce(ap.n, 0)::int as application_count,
  coalesce(ap.open_n, 0)::int as open_application_count,
  ap.latest_status as latest_application_status,
  coalesce(tk.open_tasks, 0)::int as open_task_count
from public.families f
left join public.campuses c on c.id = f.campus_id
left join public.contacts pc on pc.id = f.primary_contact_id
left join lateral (
  select count(*) as student_count,
         count(*) filter (where s.status in ('onboarding', 'active', 'on_leave')) as enrolled_count,
         array_remove(array_agg(g.sort_order), null) as grade_sorts,
         array_remove(array_agg(s.current_grade_id), null) as grade_ids,
         array_agg(distinct s.current_campus_id) as campus_ids,
         array_agg(s.id) as student_ids,
         array_agg(distinct s.status) as statuses
    from public.students s
    left join public.grades g on g.id = s.current_grade_id
   where s.family_id = f.id
) st on true
left join lateral (
  select array_agg(distinct oi.code) as codes
    from public.student_optional_selections sel
    join public.optional_items oi on oi.id = sel.item_id
    join public.students s on s.id = sel.student_id
   where s.family_id = f.id
     and sel.status in ('selected', 'paid')
) it on true
left join lateral (
  select array_agg(distinct o.type_code) as types, count(*) as n
    from public.opportunities o
   where o.family_id = f.id
     and o.status in ('identified', 'contacted', 'interested')
) op on true
left join lateral (
  select count(*) as outstanding
    from public.reenrolment_responses rr
    join public.reenrolment_cycles rc on rc.id = rr.cycle_id
    join public.students s on s.id = rr.student_id
   where s.family_id = f.id
     and rc.status = 'open'
     and rr.answered_at is null
) re on true
left join lateral (
  select count(*) as n,
         count(*) filter (where a.status not in ('enrolled', 'withdrawn', 'declined', 'offer_declined')) as open_n,
         (array_agg(a.status order by a.created_at desc))[1] as latest_status
    from public.applications a
    join public.contacts ct on ct.id = a.contact_id
   where ct.family_id = f.id
) ap on true
-- Open tasks per family, worked out once for every family rather than
-- once per family: a task is the family's through its child, or through
-- the contact who made its application.
left join (
  select coalesce(s.family_id, ct.family_id) as family_id,
         count(*) as open_tasks
    from public.tasks t
    left join public.students s on s.id = t.student_id
    left join public.applications a on a.id = t.application_id
    left join public.contacts ct on ct.id = a.contact_id
   where t.status = 'open'
     and (s.family_id is not null or ct.family_id is not null)
   group by 1
) tk on tk.family_id = f.id
where f.merged_into_id is null;

comment on view public.v_crm_family_facts is
  'One row per live family with everything a list, a segment rule or a campaign needs to know. Security invoker.';
