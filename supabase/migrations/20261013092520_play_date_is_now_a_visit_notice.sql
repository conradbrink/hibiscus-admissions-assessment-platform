-- The families told "play date" are told it is a visit.
--
-- 20261007070000 moved pre-school onto the visit wording, but the families who
-- booked before it still hold a `playdate_confirmed` email (and, for most, a
-- WhatsApp) saying their child is coming for a play date. Their booking needs
-- nothing: it was always `bookings.kind = 'visit'`, and the parent page
-- already calls it a school visit. What they need is to be told.
--
-- A one-off parent template rather than a resend of `visit_confirmed`: that
-- one reads as a fresh booking and carries a second calendar invite, which
-- would leave a parent with two entries for the same morning. This one says
-- what changed and that nothing else did.
--
-- Email only. There is deliberately no `message_templates` row for this key,
-- so the WhatsApp companion records itself as skipped instead of sending free
-- text — and nothing goes to Meta for approval.

insert into public.email_templates (key, version, name, description, audience, subject, body_html, body_text, allowed_variables, is_active)
values (
  'playdate_now_visit',
  1,
  'Play date is now a school visit',
  'One-off notice to families whose pre-school booking was confirmed as a play date: it is now a school visit, same date and time.',
  'parent',
  'Your play date at {{campus}} is now a school visit — {{assessment_date}} at {{assessment_time}}',
  '<p>Dear {{parent_first_name}},</p>'
  || '<p>We recently confirmed a play date for {{student_first_name}} at {{campus}}. We have since changed how we welcome new pre-school families: instead of a play date, we now invite you for a <strong>school visit</strong>, so you can see the school and meet the team.</p>'
  || '<p><strong>Your booking stays exactly as it was. There is nothing you need to do.</strong></p>'
  || '<table class="details"><tr><td>When</td><td>{{assessment_date}} at {{assessment_time}}</td></tr><tr><td>Where</td><td>{{campus}}{{#if location}}, {{location}}{{/if}}{{#if campus_address}}<br><span style="white-space:pre-line">{{campus_address}}{{#if campus_maps_url}}<br><a href="{{campus_maps_url}}">Get directions</a>{{/if}}</span>{{/if}}</td></tr><tr><td>Reference</td><td>{{application_reference}}</td></tr></table>'
  || '<p>At reception, give your name or the reference.</p>'
  || '<p><a href="{{next_step_link}}" class="button">View my booking</a></p>'
  || '<p>If the time no longer suits you, you can change it from the same page.</p>'
  || '<p>We look forward to showing you the school.</p>'
  || '<p>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\n'
  || E'We recently confirmed a play date for {{student_first_name}} at {{campus}}. We have since changed how we welcome new pre-school families: instead of a play date, we now invite you for a school visit, so you can see the school and meet the team.\n\n'
  || E'Your booking stays exactly as it was. There is nothing you need to do.\n\n'
  || E'When: {{assessment_date}} at {{assessment_time}}\n'
  || E'Where: {{campus}}{{#if location}}, {{location}}{{/if}}\n'
  || E'{{#if campus_address}}{{campus_address}}{{#if campus_maps_url}}\nDirections: {{campus_maps_url}}{{/if}}\n{{/if}}'
  || E'Reference: {{application_reference}}\n\n'
  || E'At reception, give your name or the reference.\n\n'
  || E'You can view or change your booking here:\n{{next_step_link}}\n\n'
  || E'We look forward to showing you the school.\n\n'
  || E'Hibiscus International Schools Admissions',
  array['parent_first_name', 'student_first_name', 'campus', 'location', 'campus_address', 'campus_maps_url', 'assessment_date', 'assessment_time', 'application_reference', 'next_step_link'],
  true
)
on conflict (key, version) do nothing;
