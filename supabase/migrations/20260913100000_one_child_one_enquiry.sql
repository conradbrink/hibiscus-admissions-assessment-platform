-- One child, one enquiry — and a moved booking that says so.
--
-- Three faults found together from one parent's WhatsApp thread. She appeared
-- in the inbox with four messages in fourteen minutes, and each of the three
-- had a hand in it.

-- ---------------------------------------------------------------------------
-- 1. A corrected surname must not create a second application
-- ---------------------------------------------------------------------------

-- She enquired twice, eighty-five seconds apart, correcting the child's
-- surname: "Manna Bah" at 18:05, "Manna Charehwa" at 18:06. Same contact row,
-- same family, same date of birth, same grade, same campus, same intake. Two
-- applications, two references, two of every message.
--
-- The duplicate check was already here and missed, because it required the
-- **surname** to match exactly. That is the weakest field in the set: it is
-- the one most often mistyped, and the one that legitimately differs between a
-- child and either parent. With the contact, the first name, the date of birth
-- and the intake all matching, it was carrying no evidence and costing
-- correctness.
--
-- The first name stays in the match, and that is what keeps twins apart: two
-- children born on the same day to the same parent have different first names,
-- and each still gets their own application.
--
-- The second change is the correction itself. Finding the existing row used to
-- discard everything the parent had just retyped, so "Manna Bah" would have
-- survived even once the duplicate was caught. A parent editing their own
-- child's name is the best information we will ever have about it, so the
-- names are updated in place. The reference is not: a returning parent keeps
-- the one they were first given and have already been told.
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

  -- Same parent, same child, same intake. `child_last_name` is deliberately
  -- not part of this: see the note above.
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
    -- What the parent has just retyped is the better spelling of their own
    -- child's name. Blank is not an instruction to erase.
    update public.applications
       set child_first_name = coalesce(nullif(trim(p_child_first_name), ''), child_first_name),
           child_last_name  = coalesce(nullif(trim(p_child_last_name),  ''), child_last_name),
           updated_at = now()
     where id = v_application_id;

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

-- ---------------------------------------------------------------------------
-- 2. The pre-school enquiry confirmation, back in step with what Meta approved
-- ---------------------------------------------------------------------------

-- Every pre-school enquiry since these templates were activated has failed at
-- the provider with "(#132000) Number of parameters does not match the
-- expected number of params", and nothing in the console said so.
--
-- The row here and the template approved with the provider had drifted apart.
-- Ours grew a fifth sentence — "You can also message us on {{5}}" — and the
-- approved template never did, so we were sending five parameters to a
-- template that expects four. Meta refuses the whole message rather than
-- dropping the extra.
--
-- This puts our row back in step with what is actually approved, which is the
-- half that can be fixed from here. The extra sentence is worth having and
-- needs a fresh submission and approval, not a migration.
update public.message_templates
   set parameters = array['parent_first_name', 'student_first_name', 'campus', 'application_reference'],
       body_preview = 'Hi {{1}}, thank you for your enquiry for {{2}} to join {{3}}. Your reference is {{4}}. Pre-school children do not sit an assessment — our admissions team will check availability and come back to you. Tap below if you would like to see the campus first.',
       updated_at = now()
 where key = 'preschool_enquiry_received';

-- ---------------------------------------------------------------------------
-- 3. A booking that moved should say it moved
-- ---------------------------------------------------------------------------

-- She booked eleven o'clock, moved it to half past nine a minute later, and
-- received the same confirmation twice with two different times and nothing to
-- say which one stood. She cancelled shortly afterwards.
--
-- `onBookingCreated` has always taken a `rescheduledFromId`, and the visit
-- branch ignored it. It now sends these instead, split pre-school from primary
-- for the same reason the confirmations are split: each is approved with the
-- provider separately, and rewording one sends it back for approval.

insert into public.email_templates (key, version, name, description, subject, body_html, body_text, allowed_variables, is_active, audience)
values
(
  'playdate_moved',
  1,
  'Play date moved',
  'Sent when a pre-school family''s play date is rescheduled, instead of confirming it again.',
  '{{student_first_name}}''s play date has moved — {{assessment_date}} at {{assessment_time}}',
  '<p>Dear {{parent_first_name}},</p><p><strong>{{student_first_name}}''s play date at {{campus}} has moved.</strong> It is now {{assessment_date}} at {{assessment_time}}. Your earlier time has been released.</p><table class="details"><tr><td>When</td><td>{{assessment_date}} at {{assessment_time}}</td></tr><tr><td>Where</td><td>{{campus}}{{#if location}}, {{location}}{{/if}}{{#if campus_address}}<br><span style="white-space:pre-line">{{campus_address}}</span>{{#if campus_maps_url}}<br><a href="{{campus_maps_url}}">Get directions</a>{{/if}}{{/if}}</td></tr><tr><td>Reference</td><td>{{application_reference}}</td></tr></table><p>Nothing else changes. At reception, give your name or the reference.</p><p><a href="{{next_step_link}}" class="button">View my booking</a></p><p>We look forward to meeting you both.</p><p>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\n{{student_first_name}}''s play date at {{campus}} has moved. It is now {{assessment_date}} at {{assessment_time}}. Your earlier time has been released.\n\nWhen: {{assessment_date}} at {{assessment_time}}\nWhere: {{campus}}{{#if location}}, {{location}}{{/if}}\n{{#if campus_address}}{{campus_address}}{{#if campus_maps_url}}\nDirections: {{campus_maps_url}}{{/if}}\n{{/if}}Reference: {{application_reference}}\n\nNothing else changes. At reception, give your name or the reference.\n\nYou can view or change your booking here:\n{{next_step_link}}\n\nWe look forward to meeting you both.\n\nHibiscus International Schools Admissions',
  array['parent_first_name','student_first_name','campus','assessment_date','assessment_time','location','campus_address','campus_maps_url','application_reference','next_step_link'],
  true,
  'parent'
),
(
  'visit_moved',
  1,
  'Visit moved',
  'Sent when a primary family''s campus visit is rescheduled, instead of confirming it again.',
  '{{student_first_name}}''s visit has moved — {{assessment_date}} at {{assessment_time}}',
  '<p>Dear {{parent_first_name}},</p><p><strong>Your visit to {{campus}} has moved.</strong> It is now {{assessment_date}} at {{assessment_time}}. Your earlier time has been released.</p><table class="details"><tr><td>When</td><td>{{assessment_date}} at {{assessment_time}}</td></tr><tr><td>Where</td><td>{{campus}}{{#if location}}, {{location}}{{/if}}{{#if campus_address}}<br><span style="white-space:pre-line">{{campus_address}}</span>{{#if campus_maps_url}}<br><a href="{{campus_maps_url}}">Get directions</a>{{/if}}{{/if}}</td></tr><tr><td>Reference</td><td>{{application_reference}}</td></tr></table><p>Nothing else changes. At reception, give your name or the reference.</p><p><a href="{{next_step_link}}" class="button">View my booking</a></p><p>We look forward to seeing you.</p><p>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\nYour visit to {{campus}} has moved. It is now {{assessment_date}} at {{assessment_time}}. Your earlier time has been released.\n\nWhen: {{assessment_date}} at {{assessment_time}}\nWhere: {{campus}}{{#if location}}, {{location}}{{/if}}\n{{#if campus_address}}{{campus_address}}{{#if campus_maps_url}}\nDirections: {{campus_maps_url}}{{/if}}\n{{/if}}Reference: {{application_reference}}\n\nNothing else changes. At reception, give your name or the reference.\n\nYou can view or change your booking here:\n{{next_step_link}}\n\nWe look forward to seeing you.\n\nHibiscus International Schools Admissions',
  array['parent_first_name','student_first_name','campus','assessment_date','assessment_time','location','campus_address','campus_maps_url','application_reference','next_step_link'],
  true,
  'parent'
)
on conflict (key, version) do nothing;

-- Inactive with no provider id, like every companion before approval.
-- `message_templates_check` refuses an active row without one, so these appear
-- greyed out in Set up → WhatsApp templates until the wording is approved and
-- somebody pastes the id in. Until then a moved booking goes by email alone —
-- which is still better than the second confirmation it used to send.
insert into public.message_templates (key, name, language, body_preview, parameters, button_link, link_purpose, is_active, audience)
values
(
  'playdate_moved',
  'Play date moved',
  'en',
  E'Hi {{1}}, {{2}}''s play date at our {{3}} campus has moved. It is now on {{4}}, starting at {{5}}. Your earlier time has been released and nothing else changes. Tap below for the details.',
  array['parent_first_name','student_first_name','campus','assessment_date','assessment_time'],
  true,
  'next_step',
  false,
  'applicant'
),
(
  'visit_moved',
  'Visit moved',
  'en',
  E'Hi {{1}}, your visit to our {{2}} campus has moved. It is now on {{3}}, starting at {{4}}. Your earlier time has been released and nothing else changes. Tap below for the details.',
  array['parent_first_name','campus','assessment_date','assessment_time'],
  true,
  'next_step',
  false,
  'applicant'
)
on conflict (key) do nothing;
