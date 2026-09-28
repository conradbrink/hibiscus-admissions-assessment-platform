-- The event follow-ups, as they were submitted to Meta.
--
-- The thank-you lost its link and its sign-off and gained a warmer close
-- when it was created in Zavu; the reminder and the last message keep their
-- link but carry it last, where the school wants every link. The previews
-- here are what staff see on the message trail, so they say what the parent
-- will read. The variables and their order are unchanged.

update public.message_templates
   set body_preview = 'Hi {{1}}, thank you for coming to our {{2}}. It was lovely to meet you and your child. If you would like to see what a week with us is like, your child is welcome to a free one-week trial at Hibiscus {{3}}.  See you soon! 🙂',
       updated_at = now()
 where key = 'event_thank_you';

update public.message_templates
   set body_preview = 'Hi {{1}}, your child''s free one-week trial at Hibiscus {{2}} is still open after our {{3}}. We would love to have you both. Booking takes two minutes: https://admissions.hibiscus.co.bw/join',
       updated_at = now()
 where key = 'event_free_trial_reminder';

update public.message_templates
   set body_preview = 'Hi {{1}}, this is our last note about our {{2}}. Enrol your child at Hibiscus {{3}} by {{4}} and they get a free Hibiscus Welcome Pack. We would love to welcome your family to Hibiscus. Want to try us first? Book a free one-week trial here: https://admissions.hibiscus.co.bw/join',
       updated_at = now()
 where key = 'event_free_trial_last_call';
