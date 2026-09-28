-- The event thank-you, as it was submitted to Meta.
--
-- The link and the sign-off came out and a warmer close went in when the
-- template was created in Zavu. The preview here is what staff see on the
-- message trail, so it says what the parent will read. The variables and
-- their order are unchanged; the reminder that follows carries the link.

update public.message_templates
   set body_preview = 'Hi {{1}}, thank you for coming to our {{2}}. It was lovely to meet you and your child. If you would like to see what a week with us is like, your child is welcome to a free one-week trial at Hibiscus {{3}}.  See you soon! 🙂',
       updated_at = now()
 where key = 'event_thank_you';
