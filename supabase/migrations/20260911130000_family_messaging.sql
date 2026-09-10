-- Asking the family, in writing.
--
-- Every message the product has ever sent has been about an application. The
-- re-enrolment round is not: it asks a family about children who enrolled
-- years ago, through applications that are terminal and may have been
-- anonymised. So the two logs learn a second subject, exactly as
-- `access_tokens` did.
--
-- The rule that a WhatsApp message is an approved template, sent only to a
-- contact who opted in, and only as the companion of an email moment, is
-- unchanged. The ask is an email; WhatsApp rides beside it as it always has.
-- Only who the moment is *about* is new.

alter table public.email_messages
  add column if not exists family_id uuid references public.families(id) on delete set null,
  add column if not exists student_id uuid references public.students(id) on delete set null;

create index if not exists email_messages_family_idx
  on public.email_messages(family_id) where family_id is not null;

alter table public.messages
  alter column application_id drop not null;

alter table public.messages
  add column if not exists family_id uuid references public.families(id) on delete set null,
  add column if not exists student_id uuid references public.students(id) on delete set null;

create index if not exists messages_family_idx
  on public.messages(family_id) where family_id is not null;

-- A message with neither subject belongs to nobody and could never be shown
-- on a record; the two logs are how staff answer "what were they told?".
alter table public.messages drop constraint if exists messages_subject_check;
alter table public.messages add constraint messages_subject_check
  check (application_id is not null or family_id is not null);

comment on column public.messages.family_id is
  'The family a message is about, when it is not about one application. Exactly one of the two is set.';

-- ---------------------------------------------------------------------------
-- Templates that speak to a family
-- ---------------------------------------------------------------------------

alter table public.email_templates drop constraint if exists email_templates_audience_check;
alter table public.email_templates add constraint email_templates_audience_check
  check (audience in ('parent', 'staff', 'family'));

alter table public.message_templates
  add column if not exists audience text not null default 'applicant'
  check (audience in ('applicant', 'family'));

-- The button on a family template carries a family link, so the closed list
-- of purposes has to admit them.
alter table public.message_templates drop constraint if exists message_templates_link_purpose_check;
alter table public.message_templates add constraint message_templates_link_purpose_check
  check (link_purpose in (
    'next_step', 'results', 'offer', 'payment', 'registration',
    'family', 'onboarding', 'reenrolment', 'checkin', 'event'
  ));

-- ---------------------------------------------------------------------------
-- Who may read a family's messages
-- ---------------------------------------------------------------------------

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select using (
    exists (
      select 1 from public.applications a
      where a.id = messages.application_id
        and (select public.has_permission('applications.read'))
        and (select public.can_access_campus(a.campus_id))
    )
    or exists (
      select 1 from public.students s
      where s.family_id = messages.family_id
        and (select public.has_permission('students.read'))
        and (select public.can_access_campus(s.current_campus_id))
    )
  );

-- `email_messages` already allowed a null application, for the staff digest.
-- A family email is not nobody's, so it is scoped like the rest of the CRM
-- rather than falling through that hole.
drop policy if exists email_messages_select on public.email_messages;
create policy email_messages_select on public.email_messages
  for select using (
    (
      (select public.has_permission('applications.read'))
      and (
        (application_id is null and family_id is null)
        or exists (
          select 1 from public.applications a
          where a.id = email_messages.application_id
            and (select public.can_access_campus(a.campus_id))
        )
      )
    )
    or exists (
      select 1 from public.students s
      where s.family_id = email_messages.family_id
        and (select public.has_permission('students.read'))
        and (select public.can_access_campus(s.current_campus_id))
    )
  );

-- ---------------------------------------------------------------------------
-- The wording
-- ---------------------------------------------------------------------------

-- Plain English, and short: this is read on a phone, and the only thing it
-- asks for is one tap. The variables stay few for the same reason the
-- WhatsApp companion does — a template with more variables than sentences is
-- one Meta refuses.
insert into public.email_templates (key, version, name, description, subject, body_text, body_html, allowed_variables, is_active, audience)
values (
  'reenrolment_ask', 1,
  'Re-enrolment: is the child coming back',
  'Sent to a family when a re-enrolment round opens. One tap answers it.',
  'Is {{student_first_name}} coming back for {{term}}?',
  'Dear {{parent_first_name}},

We are planning {{term}} at {{campus}} and we would like to hold {{student_first_name}}''s place.

Please tell us whether they are coming back. It takes a minute:
{{reenrolment_link}}

If you are not sure yet, say so — that is a useful answer too, and you can change it later.

Please answer by {{closes_on}}.

Warm regards,
Hibiscus International Schools',
  '<p>Dear {{parent_first_name}},</p>'
  || '<p>We are planning {{term}} at {{campus}} and we would like to hold {{student_first_name}}''s place.</p>'
  || '<p><a href="{{reenrolment_link}}">Tell us whether they are coming back</a></p>'
  || '<p>If you are not sure yet, say so — that is a useful answer too, and you can change it later.</p>'
  || '<p>Please answer by {{closes_on}}.</p>'
  || '<p>Warm regards,<br>Hibiscus International Schools</p>',
  array['parent_first_name', 'student_first_name', 'term', 'campus', 'closes_on', 'reenrolment_link'],
  true, 'family'
)
on conflict (key, version) do nothing;

insert into public.email_templates (key, version, name, description, subject, body_text, body_html, allowed_variables, is_active, audience)
values (
  'reenrolment_reminder', 1,
  'Re-enrolment: a reminder',
  'Sent to a family who has not answered, at the offsets the round sets.',
  'A minute of your time: is {{student_first_name}} coming back?',
  'Dear {{parent_first_name}},

We have not heard from you yet about {{term}}, and we are holding {{student_first_name}}''s place until {{closes_on}}.

One tap is all it takes:
{{reenrolment_link}}

If something has changed, or you would rather talk it through, reply to this email and we will call you.

Warm regards,
Hibiscus International Schools',
  '<p>Dear {{parent_first_name}},</p>'
  || '<p>We have not heard from you yet about {{term}}, and we are holding {{student_first_name}}''s place until {{closes_on}}.</p>'
  || '<p><a href="{{reenrolment_link}}">Tell us in one tap</a></p>'
  || '<p>If something has changed, or you would rather talk it through, reply to this email and we will call you.</p>'
  || '<p>Warm regards,<br>Hibiscus International Schools</p>',
  array['parent_first_name', 'student_first_name', 'term', 'campus', 'closes_on', 'reenrolment_link'],
  true, 'family'
)
on conflict (key, version) do nothing;

-- The WhatsApp companions, seeded inactive: each needs a template approved in
-- the provider's dashboard and its id pasted in before it can send, and the
-- send path skips a template that has not been given one.
insert into public.message_templates (key, name, language, body_preview, parameters, button_link, link_purpose, is_active, audience)
values
  (
    'reenrolment_ask',
    'Re-enrolment: is the child coming back',
    'en',
    'Hello {{1}}, we are planning {{2}} at {{3}} and would like to hold {{4}}''s place. Please tell us whether they are coming back, by {{5}}.',
    array['parent_first_name', 'term', 'campus', 'student_first_name', 'closes_on'],
    true, 'reenrolment', false, 'family'
  ),
  (
    'reenrolment_reminder',
    'Re-enrolment: a reminder',
    'en',
    'Hello {{1}}, we are still holding {{2}}''s place for {{3}} until {{4}}. One tap tells us whether they are coming back.',
    array['parent_first_name', 'student_first_name', 'term', 'closes_on'],
    true, 'reenrolment', false, 'family'
  )
on conflict (key) do nothing;

-- Off until the school has watched a round work by hand. Every automation in
-- this codebase ships this way.
insert into public.settings (key, value, description) values
  ('reenrolment_asks_enabled', 'false', 'Send the re-enrolment ask and its reminders automatically when a round is open.')
on conflict (key) do nothing;
