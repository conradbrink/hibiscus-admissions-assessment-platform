-- A family whose offer lapsed is told their visit is cancelled.
--
-- One family's offer expired while a school visit was still booked, and they
-- had just been told (20261013092520) that the visit stood. The usual
-- `booking_cancelled` email says "your enquiry stays open, choose a new date",
-- which is the wrong thing to say once the offer has lapsed. This one says the
-- visit is off, they need not come in, and who to call if they still want to
-- talk about a place.
--
-- No date or time: the booking is cancelled before this sends, so the
-- application graph has no live booking to read them from.
--
-- Email only, like the notice before it: no `message_templates` row, and the
-- key is listed in `email_only` in supabase/tests/template_coverage.sql.

insert into public.email_templates (key, version, name, description, audience, subject, body_html, body_text, allowed_variables, is_active)
values (
  'visit_cancelled_offer_expired',
  1,
  'Visit cancelled: offer expired',
  'One-off notice to a family whose offer lapsed while a school visit was still booked: the visit is cancelled and they need not come in.',
  'parent',
  '{{student_first_name}}''s visit to {{campus}} has been cancelled',
  '<p>Dear {{parent_first_name}},</p>'
  || '<p>We recently wrote to you about {{student_first_name}}''s school visit at {{campus}}. As the offer of a place for {{student_first_name}} has now expired, we have cancelled the visit, so there is no need to come in.</p>'
  || '<p>If you would still like to talk about a place for {{student_first_name}}, please get in touch with the admissions office{{#if campus_phone}} on {{campus_phone}}{{/if}} and we will be glad to help.</p>'
  || '<table class="details"><tr><td>Reference</td><td>{{application_reference}}</td></tr></table>'
  || '<p>Kind regards,</p>'
  || '<p>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\n'
  || E'We recently wrote to you about {{student_first_name}}''s school visit at {{campus}}. As the offer of a place for {{student_first_name}} has now expired, we have cancelled the visit, so there is no need to come in.\n\n'
  || E'If you would still like to talk about a place for {{student_first_name}}, please get in touch with the admissions office{{#if campus_phone}} on {{campus_phone}}{{/if}} and we will be glad to help.\n\n'
  || E'Reference: {{application_reference}}\n\n'
  || E'Kind regards,\n'
  || E'Hibiscus International Schools Admissions',
  array['parent_first_name', 'student_first_name', 'campus', 'campus_phone', 'application_reference'],
  true
)
on conflict (key, version) do nothing;
