-- One live application per child, and a key that survives a parent typing.
--
-- `create_application` has returned the existing application rather than
-- inserting since 20260913100000_one_child_one_enquiry.sql, and `campus_id`
-- was deliberately left out of the match so that a family looking at a second
-- campus joins the record they already have. That was right. The key was not.
--
-- It matched on:
--
--   contact_id + lower(child_first_name) + child_date_of_birth + intake_id
--
-- Two of those four are not the parent's to get right twice.
--
--   * `child_date_of_birth` is retyped on every enquiry form.
--   * `intake_id` is usually not chosen at all: lib/enquiry.ts falls back to
--     the first open intake, and there are four open. The same family
--     enquiring a fortnight apart lands on a different one through nobody's
--     fault, and gets a second application for it.
--
-- The one duplicate that reached production had both. Same parent, same
-- contact row, same child: date of birth 2020-03-07 then 2020-06-12, intake
-- Term 3 2026 then Term 1 2027. Either alone would have missed the match. It
-- showed up as one child holding two live applications at two campuses, two
-- sets of emails, and two places in the pipeline.
--
-- So the key becomes the question a person would ask — is this the same
-- parent, and the same child — and nothing else:
--
--   contact_id + lower(trim(child_first_name))          (status <> 'withdrawn')
--
-- `child_last_name` stays out for the reason given in
-- 20260913100000_one_child_one_enquiry.sql: a family correcting a surname
-- would otherwise get a second record.
--
-- Two things this deliberately does NOT do:
--
--   * It does not move the existing application to the newly named campus.
--     A child with a booking, an offer or a payment at one campus must not be
--     silently relocated by a parent browsing another. The application is
--     returned as it stands and the caller tells the parent where it is.
--   * It does not overwrite `child_date_of_birth` on a match, even when
--     trusted. The scholarship importer calls this function with
--     `p_trusted => true` and a placeholder date (lib/scholarship/import.ts),
--     so writing the incoming value back would replace real birthdays with
--     2010-01-01 for every imported family.

-- ---------------------------------------------------------------------------
-- 1. The rule, in the database
-- ---------------------------------------------------------------------------

-- Until now nothing enforced this but the function's own SELECT, and a
-- select-then-insert is not a rule: two tabs, a double POST or a retried
-- request can both find nothing and both insert. The partial index makes it
-- true regardless of who asks, and gives the function below a violation to
-- catch instead of a race to lose.
create unique index if not exists applications_one_live_per_child_idx
  on public.applications (contact_id, lower(trim(child_first_name)))
  where status <> 'withdrawn';

-- ---------------------------------------------------------------------------
-- 2. The function
-- ---------------------------------------------------------------------------

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
  p_heard_from_detail text default null,
  p_trusted boolean default false,
  p_start_month date default null
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
  select c.id into v_contact_id from public.contacts c where c.email_normalised = p_email_normalised;

  if v_contact_id is null then
    insert into public.contacts (first_name, last_name, email, email_normalised, mobile, mobile_normalised)
    values (
      p_parent_first_name, p_parent_last_name, p_email, p_email_normalised,
      p_mobile, p_mobile_normalised
    )
    returning id into v_contact_id;
  elsif p_trusted then
    -- The family, or the desk: what was just typed is the better spelling and
    -- the newer number. A blank does not erase a number.
    update public.contacts
       set first_name = p_parent_first_name,
           last_name = p_parent_last_name,
           email = p_email,
           mobile = coalesce(p_mobile, mobile),
           mobile_normalised = coalesce(p_mobile_normalised, mobile_normalised)
     where id = v_contact_id;
  end if;
  -- Not trusted and already on file: the contact row is left exactly as it
  -- was. Nobody types over a stranger's name or phone number.

  -- Same parent, same child. Not the same date of birth, not the same intake,
  -- not the same campus — see the header.
  select a.id, a.reference into v_application_id, v_reference
    from public.applications a
   where a.contact_id = v_contact_id
     and lower(trim(a.child_first_name)) = lower(trim(p_child_first_name))
     and a.status <> 'withdrawn'
   order by a.created_at
   limit 1;

  if v_application_id is not null then
    if p_trusted then
      update public.applications
         set child_first_name = coalesce(nullif(trim(p_child_first_name), ''), child_first_name),
             child_last_name  = coalesce(nullif(trim(p_child_last_name),  ''), child_last_name),
             -- The month is the family's to change while they are still
             -- enquiring; a re-enquiry naming a different month in the same
             -- term is the same enquiry with a corrected month.
             start_month      = coalesce(p_start_month, start_month),
             updated_at = now()
       where id = v_application_id;

      if p_heard_from is not null then
        update public.applications
           set heard_from = p_heard_from,
               heard_from_detail = nullif(p_heard_from_detail, '')
         where id = v_application_id and heard_from is null;
      end if;
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
    campus_id, grade_id, recommended_grade_id, intake_id, start_month, requires_assessment,
    entry_route, source, current_school, current_grade, heard_from, heard_from_detail
  ) values (
    v_reference, v_contact_id, p_child_first_name, p_child_last_name, p_child_date_of_birth,
    p_campus_id, p_grade_id, p_recommended_grade_id, p_intake_id, p_start_month, v_requires,
    p_entry_route, p_source, p_current_school, p_current_grade,
    p_heard_from, nullif(p_heard_from_detail, '')
  )
  returning id into v_application_id;

  insert into public.application_guardians (application_id, contact_id, relationship, is_primary)
  values (v_application_id, v_contact_id, 'parent', true);

  return query select v_application_id, v_reference, v_contact_id, true;

exception
  -- Somebody else inserted between the SELECT above and the INSERT — the two
  -- tabs, the double POST, the retried request. The index refused it, which is
  -- the outcome we want; the parent should see the application they already
  -- have rather than an error page, so read it back and answer as though the
  -- SELECT had found it. `created` is false because this call did not create
  -- it, which is exactly what the callers key their "already on file" branches
  -- on.
  when unique_violation then
    select a.id, a.reference into v_application_id, v_reference
      from public.applications a
     where a.contact_id = v_contact_id
       and lower(trim(a.child_first_name)) = lower(trim(p_child_first_name))
       and a.status <> 'withdrawn'
     order by a.created_at
     limit 1;
    if v_application_id is null then
      -- The violation was something else entirely (the reference, say). Do not
      -- swallow it: a caller told "nothing created" with no row to show for it
      -- would be worse than the error.
      raise;
    end if;
    return query select v_application_id, v_reference, v_contact_id, false;
end;
$$;

revoke execute on function public.create_application(
  text, text, text, text, text, text, text, text, date, uuid, uuid, uuid, uuid, text, text, text, text, text, text, boolean, date
) from public, anon, authenticated;
