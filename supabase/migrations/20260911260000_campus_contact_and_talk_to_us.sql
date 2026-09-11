-- A way to reach a person, and the two numbers that make it possible.
--
-- Everything a parent needs in order to talk to somebody already existed, in
-- `campuses.address`, as one free-text blob:
--
--     Plot 59140, Block 7, Gaborone
--     +267 392 4299
--     Main office +267 72 320 145
--
-- That prints beautifully on a letter and is useless anywhere else: a phone
-- link needs the digits on their own, and a WhatsApp link needs them without
-- spaces. So the two numbers get columns of their own. The blob stays exactly
-- as it is, because the offer letter renders it verbatim and this migration
-- is not the place to re-cut that.

alter table public.campuses
  add column if not exists phone text,
  add column if not exists whatsapp text;

comment on column public.campuses.phone is
  'The campus office line, for a parent who would rather call. Shown as a tel: link.';
comment on column public.campuses.whatsapp is
  'The number the admissions team answers on WhatsApp. Shown as a wa.me link, so it is stored as typed and normalised at render.';

-- ---------------------------------------------------------------------------
-- Backfill, from the blob
-- ---------------------------------------------------------------------------

-- Every campus lists the shared admissions number, most of them labelled
-- "Main office"; the campuses that have only one number list that one. Taking
-- the *last* number on the label, or the only number present, gets both cases
-- without naming the number here — a school that changes it changes the data,
-- not a migration.
update public.campuses
   set whatsapp = coalesce(whatsapp, (
         select m[1]
           from regexp_matches(address, '(\+[0-9][0-9 ]{6,})', 'g') as m
          order by 1 desc
          limit 1
       ))
 where address is not null and whatsapp is null;

-- The campus's own line is the first number listed. Where a campus lists only
-- the shared one, phone and whatsapp are the same number, which is true.
update public.campuses
   set phone = coalesce(phone, (
         select (regexp_matches(address, '(\+[0-9][0-9 ]{6,})'))[1]
       ))
 where address is not null and phone is null;

-- Trailing whitespace from the line breaks they were cut out of.
update public.campuses set phone = trim(phone) where phone is not null;
update public.campuses set whatsapp = trim(whatsapp) where whatsapp is not null;

-- Potch is in South Africa and answers on a South African number. The blob it
-- was typed into carried the Botswana main-office line instead, so the pattern
-- above would have handed it a number nobody in Potchefstroom picks up — and
-- that same wrong number was already printing on its letters. Its street
-- address was a city rather than an address, which is no use to a parent
-- trying to find the place. Both corrected here, from the school.
update public.campuses
   set phone = '+27 61 097 5213',
       whatsapp = '+27 61 097 5213',
       address = '23 Maury Avenue, Potchefstroom, North West, South Africa' || chr(10) || '+27 61 097 5213'
 where code = 'potch';

-- ---------------------------------------------------------------------------
-- "Talk to us"
-- ---------------------------------------------------------------------------

-- One more moment in the funnel, and the only one that exists to hand a family
-- a person rather than a next step. Sent on request rather than on a trigger:
-- nothing in the workflow queues it, staff send it from the applicant.
insert into public.email_templates (key, version, name, description, subject, body_html, body_text, allowed_variables, is_active, audience)
values (
  'talk_to_us',
  1,
  'Talk to our admissions team',
  'The campus address and the two ways to reach a person. Sent when a family would rather speak to somebody than click something.',
  'Talking to us about {{student_first_name}}',
  '<p>Hello {{parent_first_name}},</p>'
  || '<p>If you would like to talk to somebody about {{student_first_name}}''s place at {{campus}}, we would rather you did than wondered.</p>'
  || '<p><strong>WhatsApp our admissions team</strong><br>{{campus_whatsapp}}<br>Messages are answered during office hours.</p>'
  || '{{#if campus_phone}}<p><strong>Or call the campus</strong><br>{{campus_phone}}</p>{{/if}}'
  || '<p><strong>Or come and see us</strong><br>{{campus_address}}</p>'
  || '<p>You can also reply to this email and it reaches the same team.</p>',
  'Hello {{parent_first_name}},'
  || E'\n\n'
  || 'If you would like to talk to somebody about {{student_first_name}}''s place at {{campus}}, we would rather you did than wondered.'
  || E'\n\n'
  || 'WhatsApp our admissions team: {{campus_whatsapp}}'
  || E'\n'
  || 'Call the campus: {{campus_phone}}'
  || E'\n\n'
  || 'Or come and see us:'
  || E'\n'
  || '{{campus_address}}'
  || E'\n\n'
  || 'You can also reply to this email and it reaches the same team.',
  array['parent_first_name', 'student_first_name', 'campus', 'campus_address', 'campus_phone', 'campus_whatsapp'],
  true,
  -- `email_templates` says 'parent' where `message_templates` says
  -- 'applicant' for the same reader. Neither table is wrong; they were
  -- written months apart.
  'parent'
)
-- `email_templates` is unique on (key, version), not key: a template's history
-- is kept and one row per key is active at a time.
on conflict (key, version) do nothing;

-- The WhatsApp companion, inactive: the wording still has to be approved by
-- the provider, and the constraint added a moment ago refuses an active
-- template with no id to address it by. It appears in the console greyed out,
-- which is the honest state — approved wording, not yet approved.
insert into public.message_templates (key, name, language, body_preview, parameters, button_link, link_purpose, is_active, audience)
values (
  'talk_to_us',
  'Talk to our admissions team',
  'en',
  'Hi {{1}}, if you would like to talk to somebody about {{2}}''s place at {{3}}, message us here or call {{4}}. You are also welcome at {{5}}.',
  array['parent_first_name', 'student_first_name', 'campus', 'campus_phone', 'campus_address'],
  false,
  'next_step',
  false,
  'applicant'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- The offer letter's letterhead
-- ---------------------------------------------------------------------------

-- A parent who prints the offer had no way of knowing which campus wrote it
-- beyond the sentence naming the class, and no way to reach that campus at
-- all. `campus_address` already carries the street address and both numbers,
-- so the header needs one variable rather than three.
update public.offer_templates
   set allowed_variables = (
         select array(
           select distinct v
             from unnest(allowed_variables || array['campus_address', 'campus_phone']) as v
            order by v
         )
       )
 where not (allowed_variables @> array['campus_address']);

-- `white-space: pre-line` rather than <br>: the renderer HTML-escapes every
-- value, by design, so markup inside one arrives as literal text. The address
-- is stored with the line breaks it should print with, and CSS is what keeps
-- them.
update public.offer_templates
   set body_html =
         '<p style="margin:0 0 18px;padding-bottom:10px;border-bottom:1px solid #dddddd;font-size:12px;line-height:1.55;color:#444444;white-space:pre-line">'
         || '<strong>Hibiscus International Schools &middot; {{campus}}</strong>' || E'\n' || '{{campus_address}}'
         || '</p>'
         || body_html
 where body_html not like '%Hibiscus International Schools &middot; {{campus}}%';
