-- The enquiry form is anonymous, and must act like it.
--
-- Two holes found on the end-to-end walkthrough of 14 September 2026, both in
-- `create_application`, and both reachable by anyone who knows a parent's
-- email address — an ex-partner, a colleague, a classmate's parent.
--
-- 1. The contact upsert overwrote the parent's name and mobile number with
--    whatever the form carried. The mobile is where the WhatsApp companions
--    go, links included, so a stranger could redirect a family's links to
--    their own phone by typing the family's email address into /join.
--
-- 2. With the child's first name and date of birth as well, the function
--    returned the *existing* application, and the form then started a parent
--    session on it: the offer, the payment page, the medical form and the
--    documents of a child the requester may have no right to see.
--
-- The function now takes `p_trusted`. Staff at the desk and a parent whose
-- browser already holds a session for this family are trusted, and get the
-- behaviour that has always existed (the corrected spelling wins, the number
-- is updated). An anonymous form that names an address already on file is
-- not: it touches nothing that exists. A matching application is *found* but
-- not edited; a new child is added to the family without the contact row
-- changing; and the caller (`submitEnquiry`) sends the link by email instead
-- of handing over a session, which is what proves the address is theirs.
--
-- The 19-parameter signature is dropped rather than overloaded: PostgREST
-- calls by name, and two matching functions is "function is not unique".
drop function if exists public.create_application(
  text, text, text, text, text, text, text, text, date, uuid, uuid, uuid, uuid, text, text, text, text, text, text
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
  p_heard_from_detail text default null,
  p_trusted boolean default false
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

  -- Same parent, same child, same intake. `child_last_name` is deliberately
  -- not part of this: see 20260913100000_one_child_one_enquiry.sql.
  select a.id, a.reference into v_application_id, v_reference
    from public.applications a
   where a.contact_id = v_contact_id
     and lower(a.child_first_name) = lower(p_child_first_name)
     and a.child_date_of_birth = p_child_date_of_birth
     and a.intake_id = p_intake_id
     and a.status <> 'withdrawn'
   order by a.created_at
   limit 1;

  if v_application_id is not null then
    if p_trusted then
      update public.applications
         set child_first_name = coalesce(nullif(trim(p_child_first_name), ''), child_first_name),
             child_last_name  = coalesce(nullif(trim(p_child_last_name),  ''), child_last_name),
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
  text, text, text, text, text, text, text, text, date, uuid, uuid, uuid, uuid, text, text, text, text, text, text, boolean
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A booking belongs to the campus the child applied to
-- ---------------------------------------------------------------------------
-- `book_session` checked the grade band, the capacity and the clock, and never
-- that the session was at the child's campus. The parent's action checks it in
-- TypeScript; the staff reschedule did not, so a stale form could seat a
-- Block 7 child in a Broadhurst sitting, where the board would never list them.
-- The rule belongs in the one place every booking passes through.
create or replace function public.book_session(
  p_application_id uuid,
  p_session_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  s public.sessions%rowtype;
  v_grade_sort int;
  v_campus_id uuid;
  v_booking_id uuid;
begin
  select * into s from public.sessions where id = p_session_id for update;
  if not found or not s.is_published then
    raise exception 'session_unavailable';
  end if;
  if s.starts_at <= now() then
    raise exception 'session_in_past';
  end if;

  select g.sort_order, a.campus_id into v_grade_sort, v_campus_id
  from public.applications a
  join public.grades g on g.id = a.grade_id
  where a.id = p_application_id;

  if v_grade_sort is null then
    raise exception 'application_not_found';
  end if;

  if v_campus_id <> s.campus_id then
    raise exception 'session_wrong_campus';
  end if;

  if (s.min_grade_sort is not null and v_grade_sort < s.min_grade_sort)
     or (s.max_grade_sort is not null and v_grade_sort > s.max_grade_sort) then
    raise exception 'grade_not_in_range';
  end if;

  if public.session_places_taken(p_session_id) >= s.capacity then
    raise exception 'session_full';
  end if;

  insert into public.bookings (application_id, session_id, kind)
  values (p_application_id, p_session_id, s.kind)
  returning id into v_booking_id;

  return v_booking_id;
exception
  when unique_violation then
    raise exception 'already_booked';
end;
$$;
revoke execute on function public.book_session(uuid, uuid) from public, anon, authenticated;
