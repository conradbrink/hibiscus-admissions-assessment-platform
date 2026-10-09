-- ===========================================================================
-- The two functions that change what an application *is*: moving it between
-- the three pipeline categories, and removing an applicant's personal data
-- when the retention period ends. Both are for the service role alone: the
-- HR app checks the person's permission, then calls these.
-- ===========================================================================

-- Moves an application between Review, Shortlisted and Unsuccessful, or marks
-- it hired or withdrawn. Compare-and-set on the stage the caller saw, so two
-- people moving the same card at once cannot both win: the second gets
-- `stale_stage` and reloads.
create or replace function public.hr_commit_stage(
  p_application_id uuid,
  p_expected_stage text,
  p_to_stage text,
  p_reason text,
  p_actor_id uuid,
  p_to_status text default null
)
returns public.hr_applications
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_app public.hr_applications%rowtype;
begin
  if p_to_stage not in ('review', 'shortlisted', 'unsuccessful') then
    raise exception 'invalid_stage';
  end if;
  if p_to_status is not null and p_to_status not in ('hired', 'withdrawn') then
    raise exception 'invalid_status';
  end if;

  select * into v_app from public.hr_applications where id = p_application_id for update;
  if not found then
    raise exception 'application_not_found';
  end if;
  if v_app.status not in ('submitted') then
    raise exception 'application_not_open' using hint = v_app.status;
  end if;
  if v_app.stage is distinct from p_expected_stage then
    raise exception 'stale_stage' using hint = coalesce(v_app.stage, 'none');
  end if;
  -- Hiring is only ever from the shortlist.
  if p_to_status = 'hired' and p_to_stage <> 'shortlisted' then
    raise exception 'hire_needs_shortlist';
  end if;

  update public.hr_applications
     set stage = p_to_stage,
         stage_reason = p_reason,
         stage_changed_at = now(),
         stage_changed_by = p_actor_id,
         status = coalesce(p_to_status, status),
         withdrawn_at = case when p_to_status = 'withdrawn' then now() else withdrawn_at end
   where id = p_application_id
  returning * into v_app;

  insert into public.hr_application_events (application_id, kind, detail, actor_type, actor_id)
  values (
    p_application_id,
    case when p_to_status is not null then p_to_status else 'stage_changed' end,
    jsonb_build_object('from', p_expected_stage, 'to', p_to_stage, 'reason', p_reason),
    case when p_actor_id is null then 'system' else 'staff' end,
    p_actor_id
  );

  return v_app;
end;
$$;

revoke execute on function public.hr_commit_stage(uuid, text, text, text, uuid, text) from public, anon, authenticated;

-- Removes an applicant's personal data and keeps the numbers: the vacancy,
-- the campus, the dates, the stage and the score stay, so "how many
-- applicants did the Grade 3 post get" is still answerable. Files are deleted
-- from storage by the HR app first (hr/lib/retention.ts), because nothing
-- here may touch `storage.*`.
--
-- Refuses a hired applicant: their record became an employee record, which
-- has its own, longer, retention.
create or replace function public.hr_anonymise_applicant(p_application_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  select status into v_status from public.hr_applications where id = p_application_id for update;
  if not found then
    return false;
  end if;
  if v_status = 'hired' then
    raise exception 'hired_applicant_not_anonymised';
  end if;
  if v_status = 'anonymised' then
    return false;
  end if;

  update public.hr_applications
     set email = 'removed-' || id || '@invalid',
         email_normalised = 'removed-' || id || '@invalid',
         first_name = 'Removed',
         last_name = 'Applicant',
         phone = null,
         nationality = null,
         is_citizen = null,
         stage_reason = null,
         communication_ai_rationale = null,
         status = 'anonymised',
         anonymised_at = now(),
         retention_due_at = null
   where id = p_application_id;

  delete from public.hr_application_compliance where application_id = p_application_id;
  delete from public.hr_application_documents where application_id = p_application_id;
  delete from public.hr_application_notes where application_id = p_application_id;
  delete from public.hr_reference_responses where application_id = p_application_id;
  delete from public.hr_referees where application_id = p_application_id;
  delete from public.hr_access_tokens where hr_application_id = p_application_id;

  update public.hr_application_answers
     set answer_text = '',
         integrity = '{}'::jsonb,
         ai_rationale = null,
         ai_evidence = null,
         human_note = null,
         ai_likelihood_reasons = null
   where application_id = p_application_id;

  update public.hr_application_employment
     set employer = 'Removed', reason_for_leaving = null
   where application_id = p_application_id;

  update public.hr_application_qualifications
     set institution = 'Removed'
   where application_id = p_application_id;

  update public.hr_email_messages
     set to_email = 'removed@invalid', body_html = '', body_text = '', subject = 'Removed'
   where hr_application_id = p_application_id;

  update public.hr_application_scores set inputs = '{}'::jsonb where application_id = p_application_id;

  update public.hr_interviews set notes = null where application_id = p_application_id;

  delete from public.hr_application_events
   where application_id = p_application_id and kind not in ('submitted', 'stage_changed', 'withdrawn');

  insert into public.hr_application_events (application_id, kind, detail, actor_type)
  values (p_application_id, 'anonymised', '{}'::jsonb, 'system');

  return true;
end;
$$;

revoke execute on function public.hr_anonymise_applicant(uuid) from public, anon, authenticated;
