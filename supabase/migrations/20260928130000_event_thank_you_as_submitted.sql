-- The event follow-ups, as they were submitted to Meta.
--
-- Written from the school's own follow-up copy, made universal: the child
-- is "your child", the offer is a free one-week trial, the campus (and on
-- the thank-you, the event) is a variable, and every link is the last thing
-- in the message. Each template numbers only the variables it uses, from
-- {{1}} without gaps, because Meta refuses a template that skips a number:
-- so the reminder takes the parent and the campus, and the last message
-- the parent, the campus and the deadline. The campaigns map by name, so
-- the new order needs nothing from them.

update public.message_templates
   set body_preview = 'Hi {{1}}, thank you for coming to our {{2}}. It was lovely to meet you and your child. If you would like to see what a week with us is like, your child is welcome to a free one-week trial at Hibiscus {{3}}. See you soon! 🙂',
       parameters = array['parent_first_name','event_name','campus'],
       updated_at = now()
 where key = 'event_thank_you';

update public.message_templates
   set body_preview = 'Hi {{1}}, your child''s free one-week trial at Hibiscus {{2}} is still open. We''d love to have you both. Booking takes two minutes: https://admissions.hibiscus.co.bw/join',
       parameters = array['parent_first_name','campus'],
       updated_at = now()
 where key = 'event_free_trial_reminder';

update public.message_templates
   set body_preview = 'Hi {{1}}, this is our last note about it. Enrol your child at Hibiscus {{2}} by {{3}} and they get a free Hibiscus Welcome Pack. We''d love to welcome your family to Hibiscus. Want to try us first? Book a free one-week trial here: https://admissions.hibiscus.co.bw/join',
       parameters = array['parent_first_name','campus','deadline'],
       updated_at = now()
 where key = 'event_free_trial_last_call';
