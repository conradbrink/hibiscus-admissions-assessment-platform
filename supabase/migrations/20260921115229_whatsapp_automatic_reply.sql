-- Answer a parent who writes to the line that only sends updates.
--
-- They write to it because it looks like a chat, and nothing in the message
-- says otherwise. Their reply is not lost — `handleReply` raises a task for
-- the campus team — but the parent hears nothing and goes on believing they
-- have asked the school a question. The enquiry email now warns them
-- (20260921120000); this is the sentence they get at the moment they get it
-- wrong anyway, which is the only moment they are certain to read it.
--
-- Free text, not a template. WhatsApp allows it inside the 24-hour window a
-- parent's own message opens, so it needs no approval from Meta — which
-- matters when the thing being said is "you are writing to the wrong number",
-- and doubly when the school is waiting on Meta for other templates.
--
-- The wording is here rather than in the code, so the school can change it
-- without a deploy. `{{whatsapp}}` is the campus's manned number and
-- `{{phone}}` its office line; the clause between `{{#phone}}` and
-- `{{/phone}}` is dropped whole for a campus with no phone number, rather
-- than leaving a sentence with a hole in it.
--
-- On by default. Saying nothing is the state that caused the problem, and a
-- school that disagrees turns it off in one row.

insert into public.settings (key, value, description)
values
  (
    'whatsapp_auto_reply_enabled',
    'true'::jsonb,
    'Answer a parent who writes to the WhatsApp updates line, telling them where somebody is actually reading. At most once a day per parent.'
  ),
  (
    'whatsapp_auto_reply_text',
    to_jsonb(
      'Thank you for your message. This number only sends updates about your application and nobody reads replies to it. ' ||
      'To talk to somebody please message us on {{whatsapp}}{{#phone}} or call {{phone}}{{/phone}}. ' ||
      'We have passed your message on either way.'
    ),
    'What that reply says. {{whatsapp}} is the campus''s manned WhatsApp number and {{phone}} its office line; the part between {{#phone}} and {{/phone}} is dropped for a campus with no phone number.'
  )
on conflict (key) do nothing;
