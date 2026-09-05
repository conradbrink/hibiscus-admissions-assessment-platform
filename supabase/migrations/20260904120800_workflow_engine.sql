-- The one function that moves an application.
--
-- The state machine — which transitions are legal, what each one causes —
-- lives in TypeScript (web/lib/workflow), where it is typed, diffable and
-- unit-tested. What it cannot do from there is make five writes atomic:
-- PostgREST has no multi-statement transaction. So the engine computes the
-- full set of writes a transition implies and hands them to this function,
-- which applies them in one transaction or not at all.
--
-- It is deliberately dumb. It does not know what 'assessment_booked' means or
-- what may follow it. It checks the application is still in the state the
-- engine believed it was in (optimistic concurrency), then writes.
--
-- Only the service role may call it. Combined with the column grant in
-- 20260904120200_applications.sql, that makes the engine the single writer of
-- `applications.status`.

create or replace function public.commit_transition(
  p_application_id uuid,
  -- Null skips the check. Otherwise the current status must equal this, or
  -- the whole call is refused with 'status_conflict'.
  p_expected_status text,
  -- Null leaves the status unchanged (an event that is not a transition).
  p_new_status text,
  p_next_action text,
  p_next_action_due_at timestamptz,
  -- {type, summary, payload, actor_type, actor_id}
  p_event jsonb,
  -- [{type, title, details, priority, due_at, assignee_staff_id}]
  p_tasks jsonb default '[]'::jsonb,
  -- Open tasks of these types on this application are marked done.
  p_resolve_task_types text[] default '{}'::text[],
  -- [{type, payload, idempotency_key, run_after, precondition}]
  p_jobs jsonb default '[]'::jsonb,
  -- {action, entity_type, entity_id, before, after, actor_label, ip_hash}
  p_audit jsonb default null
)
returns bigint
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  a public.applications%rowtype;
  v_event_id bigint;
  v_actor_type text := coalesce(p_event->>'actor_type', 'system');
  v_actor_id uuid := nullif(p_event->>'actor_id', '')::uuid;
  t jsonb;
  j jsonb;
begin
  select * into a from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'application_not_found';
  end if;

  if p_expected_status is not null and a.status <> p_expected_status then
    raise exception 'status_conflict: expected %, found %', p_expected_status, a.status;
  end if;

  -- A null new status is a pure event: the timeline gains a row and nothing
  -- on the application changes. Passing the *current* status updates the
  -- next action without touching status_changed_at, which is how "the parent
  -- did something that does not move the pipeline" is expressed.
  if p_new_status is not null then
    update public.applications
       set status = p_new_status,
           status_changed_at = case
             when p_new_status <> a.status then now()
             else status_changed_at
           end,
           next_action = p_next_action,
           next_action_due_at = p_next_action_due_at
     where id = p_application_id;
  end if;

  insert into public.application_events (application_id, type, actor_type, actor_id, summary, payload)
  values (
    p_application_id,
    p_event->>'type',
    v_actor_type,
    v_actor_id,
    p_event->>'summary',
    coalesce(p_event->'payload', '{}'::jsonb)
  )
  returning id into v_event_id;

  if array_length(p_resolve_task_types, 1) > 0 then
    update public.tasks
       set status = 'done',
           resolved_at = now(),
           resolved_by = case when v_actor_type = 'staff' then v_actor_id end,
           resolution_note = 'Resolved automatically: ' || (p_event->>'type')
     where application_id = p_application_id
       and status = 'open'
       and type = any(p_resolve_task_types);
  end if;

  for t in select * from jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb)) loop
    insert into public.tasks (
      application_id, campus_id, type, title, details, priority, due_at,
      assignee_staff_id, created_by_type, created_by
    ) values (
      p_application_id,
      a.campus_id,
      t->>'type',
      t->>'title',
      t->>'details',
      coalesce(t->>'priority', 'normal'),
      nullif(t->>'due_at', '')::timestamptz,
      nullif(t->>'assignee_staff_id', '')::uuid,
      case when v_actor_type = 'staff' then 'staff' else 'system' end,
      case when v_actor_type = 'staff' then v_actor_id end
    );
  end loop;

  for j in select * from jsonb_array_elements(coalesce(p_jobs, '[]'::jsonb)) loop
    insert into public.jobs (type, payload, application_id, idempotency_key, run_after, precondition)
    values (
      j->>'type',
      coalesce(j->'payload', '{}'::jsonb),
      p_application_id,
      j->>'idempotency_key',
      coalesce(nullif(j->>'run_after', '')::timestamptz, now()),
      j->'precondition'
    )
    -- A transition replayed after a partial failure must not queue the same
    -- reminder twice.
    on conflict (idempotency_key) do nothing;
  end loop;

  if p_audit is not null then
    insert into public.audit_log (
      actor_type, actor_id, actor_label, action, entity_type, entity_id,
      application_id, before, after, ip_hash
    ) values (
      v_actor_type,
      v_actor_id,
      p_audit->>'actor_label',
      p_audit->>'action',
      coalesce(p_audit->>'entity_type', 'application'),
      coalesce(nullif(p_audit->>'entity_id', '')::uuid, p_application_id),
      p_application_id,
      p_audit->'before',
      p_audit->'after',
      p_audit->>'ip_hash'
    );
  end if;

  return v_event_id;
end;
$$;

revoke execute on function public.commit_transition(
  uuid, text, text, text, timestamptz, jsonb, jsonb, text[], jsonb, jsonb
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Creating an application
-- ---------------------------------------------------------------------------

-- Contact upsert, reference allocation and the application row, atomically.
--
-- Idempotent on (contact, child name, date of birth, intake): a parent who
-- double-taps Submit, or whose first attempt timed out after the insert, gets
-- the same application back rather than a second one. The current form's
-- equivalent is a duplicate the school has to find and merge by hand.
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
  p_current_grade text default null
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
    entry_route, source, current_school, current_grade
  ) values (
    v_reference, v_contact_id, p_child_first_name, p_child_last_name, p_child_date_of_birth,
    p_campus_id, p_grade_id, p_recommended_grade_id, p_intake_id, v_requires,
    p_entry_route, p_source, p_current_school, p_current_grade
  )
  returning id into v_application_id;

  insert into public.application_guardians (application_id, contact_id, relationship, is_primary)
  values (v_application_id, v_contact_id, 'parent', true);

  return query select v_application_id, v_reference, v_contact_id, true;
end;
$$;

revoke execute on function public.create_application(
  text, text, text, text, text, text, text, text, date, uuid, uuid, uuid, uuid, text, text, text, text
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Dashboard counts
-- ---------------------------------------------------------------------------

-- One round trip for the staff dashboard tiles. security definer is NOT used:
-- it runs as the caller, so a campus-restricted member of staff counts only
-- their own campuses, through the same policies as every other read.
create or replace function public.dashboard_counts()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with today as (
    select
      (now() at time zone 'Africa/Gaborone')::date as d
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
    'offers_outstanding',
      (select count(*) from public.applications where status = 'offer_sent'),
    'payments_outstanding',
      (select count(*) from public.applications where status in ('payment_required', 'payment_processing')),
    'registrations_incomplete',
      (select count(*) from public.applications where status = 'registration_incomplete'),
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
