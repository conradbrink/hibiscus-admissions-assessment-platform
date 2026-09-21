-- Parents are replying to the WhatsApp line that sends the updates.
--
-- It looks like a chat: a message arrives from a number, and the obvious
-- thing to do with a number that has just written to you is write back.
-- Nothing tells them otherwise. Their reply does become a task for the
-- campus team, so it is not lost, but the parent hears nothing back and
-- believes they have asked the school a question.
--
-- The enquiry confirmation is the first thing every family reads, and it
-- said nothing about WhatsApp at all. It says this now, in both tracks,
-- before the first update can arrive and be replied to.
--
-- The number to write to is the campus's own (`campuses.whatsapp`) rather
-- than a constant: the Botswana campuses share one manned number and the
-- two Potchefstroom campuses share another, and a family sent to the wrong
-- country is worse off than one sent nowhere. `campus_phone` comes along
-- for the family who would rather ring.
--
-- This is the half that can ship today. The WhatsApp templates say the same
-- thing only once Meta has approved wording that carries the number, and an
-- automatic reply to a parent who writes in anyway is a separate change.

update email_templates
set is_active = false, updated_at = now()
where key in ('enquiry_received', 'preschool_enquiry_received') and is_active;

insert into email_templates (key, version, name, description, subject, body_text, body_html, allowed_variables, is_active, audience)
select
  t.key,
  t.version + 1,
  t.name,
  t.description,
  t.subject,
  b.body_text,
  b.body_html,
  (select array_agg(distinct v order by v)
     from unnest(t.allowed_variables || array['campus_whatsapp', 'campus_phone']) as v),
  true,
  t.audience
from email_templates t
join (values
  (
    'enquiry_received',
'Dear {{parent_first_name}},

Thank you for your interest in Hibiscus International Schools. We received your enquiry for {{student_first_name}} to join {{campus}} in {{grade}}.

Your reference is {{application_reference}}. Please keep it. You will need it when you contact us.

Your next step is to book an assessment. It takes about one minute:
{{next_step_link}}

One thing about WhatsApp: our updates are sent from an automatic number, and nobody reads replies to it. To talk to somebody about {{student_first_name}}, message us on {{campus_whatsapp}} or call {{campus_phone}}.

Warm regards,
Hibiscus International Schools Admissions',
    '<p>Dear {{parent_first_name}},</p>'
    || '<p>Thank you for your interest in Hibiscus International Schools. We received your enquiry for {{student_first_name}} to join {{campus}} in {{grade}}.</p>'
    || '<p>Your reference is <strong>{{application_reference}}</strong>. Please keep it. You will need it when you contact us.</p>'
    || '<p>Your next step is to book an assessment. It takes about one minute:</p>'
    || '<p><a href="{{next_step_link}}">Book an assessment</a></p>'
    || '<p><strong>One thing about WhatsApp:</strong> our updates are sent from an automatic number, and nobody reads replies to it. '
    || 'To talk to somebody about {{student_first_name}}, message us on <strong>{{campus_whatsapp}}</strong> or call <strong>{{campus_phone}}</strong>.</p>'
    || '<p>Warm regards,<br>Hibiscus International Schools Admissions</p>'
  ),
  (
    'preschool_enquiry_received',
'Dear {{parent_first_name}},

Thank you for your interest in Hibiscus International Schools. We received your enquiry for {{student_first_name}} to join {{campus}} in {{grade}}.

Your reference is {{application_reference}}.

Our admissions team will check whether there is a place and come back to you. If you would like to see the campus first, you can book a play date:
{{next_step_link}}

One thing about WhatsApp: our updates are sent from an automatic number, and nobody reads replies to it. To talk to somebody about {{student_first_name}}, message us on {{campus_whatsapp}} or call {{campus_phone}}.

Warm regards,
Hibiscus International Schools Admissions',
    '<p>Dear {{parent_first_name}},</p>'
    || '<p>Thank you for your interest in Hibiscus International Schools. We received your enquiry for {{student_first_name}} to join {{campus}} in {{grade}}.</p>'
    || '<p>Your reference is <strong>{{application_reference}}</strong>.</p>'
    || '<p>Our admissions team will check whether there is a place and come back to you. If you would like to see the campus first, you can book a play date:</p>'
    || '<p><a href="{{next_step_link}}">Book a play date</a></p>'
    || '<p><strong>One thing about WhatsApp:</strong> our updates are sent from an automatic number, and nobody reads replies to it. '
    || 'To talk to somebody about {{student_first_name}}, message us on <strong>{{campus_whatsapp}}</strong> or call <strong>{{campus_phone}}</strong>.</p>'
    || '<p>Warm regards,<br>Hibiscus International Schools Admissions</p>'
  )
) as b(key, body_text, body_html) on b.key = t.key
where t.version = (select max(version) from email_templates m where m.key = t.key);
