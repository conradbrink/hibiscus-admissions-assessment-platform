-- A reminder for any event, as one WhatsApp template.
--
-- A week before, two days before and on the day are the same sentence with
-- a different "when": so the when is a variable the campaign types
-- ("next Thursday, 8 October, from 18:30", "tonight from 18:30") rather than
-- three templates for Meta to approve. The event's name and place fill
-- themselves from the event the campaign is for, the parent's first name
-- from the family. First used for the Pre-Reception & Reception Parents'
-- Social Evening; nothing in it is that evening's.
--
-- Inactive until Meta's approval through Zavu is recorded, with an inactive
-- email companion (the coverage suite's rule: a message template has an
-- email moment). Campaigns carry their own email wording.

insert into public.message_templates (key, name, language, body_preview, parameters, button_link, link_purpose, is_active, audience)
values ('event_reminder', 'Event: reminder', 'en',
        'Hi {{1}}, a friendly reminder that our {{2}} is {{3}}, at {{4}}. We look forward to seeing you there.',
        array['parent_first_name','event_name','event_when','event_location'], false, 'event', false, 'family')
on conflict (key) do nothing;

insert into public.email_templates (key, version, name, description, subject, body_text, body_html, allowed_variables, is_active, audience)
values ('event_reminder', 1, 'Event: reminder',
        'The email side of an event reminder. Campaigns carry their own wording; inactive until an automation needs it.',
        'A reminder: {{event_name}}',
        E'Dear {{parent_first_name}},\n\nA friendly reminder that our {{event_name}} is on {{event_date}}, at {{event_location}}.\n\nWe look forward to seeing you there.\n\nWarm regards,\nThe Hibiscus Team',
        '<p>Dear {{parent_first_name}},</p><p>A friendly reminder that our {{event_name}} is on {{event_date}}, at {{event_location}}.</p><p>We look forward to seeing you there.</p><p>Warm regards,<br>The Hibiscus Team</p>',
        array['parent_first_name','event_name','event_date','event_location'], false, 'family')
on conflict do nothing;
