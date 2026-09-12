-- The four onboarding companions, worded for a number nobody answers.
--
-- These were seeded when the onboarding journey was built and have sat
-- inactive since, waiting on Zavu approval. Reading them again before they go
-- for it, two of the four invite a reply:
--
--   first_day_details    "...just reply to this message"
--   first_week_check_in  "...Just reply to this message — someone from the
--                         campus will read it and come back to you"
--
-- The WhatsApp number these go out from is not manned. The first is a promise
-- nobody keeps; the second is worse, because it has no button at all, so
-- replying is the only thing the message offers a parent to do — and a family
-- whose child has just finished their first week is exactly the family whose
-- answer the school wants.
--
-- Both now name the campus's own number, as a variable: Potch is a South
-- African number and every Botswana campus shares another.

update public.message_templates
   set body_preview = E'Hi {{1}}, {{2}}''s first day at {{3}} is {{4}}. Please arrive by {{5}}. Tap below for where to go and what to bring. If you need anything before then, message us on {{6}} and we will help.',
       parameters = array['parent_first_name','student_first_name','campus','start_date','arrival_time','campus_whatsapp']
 where key = 'first_day_details';

update public.message_templates
   set body_preview = E'Hi {{1}}, {{2}} has finished their first week at {{3}}. How did it go? Message us on {{4}} and someone from the campus will read it and come back to you.',
       parameters = array['parent_first_name','student_first_name','campus','campus_whatsapp']
 where key = 'first_week_check_in';

-- A companion's parameters must be a subset of its email's allowed variables
-- (lib/messaging/template-checks.ts). The emails do not print the number —
-- a parent can reply to an email, and that inbox is read — but the list has
-- to admit it.
update public.email_templates
   set allowed_variables = allowed_variables || array['campus_whatsapp']
 where key in ('first_day_details', 'first_week_check_in')
   and is_active
   and not ('campus_whatsapp' = any(allowed_variables));

-- And one more word in the third, because the sentence it had put five
-- variables in a hundred characters: Meta refuses a template with "too many
-- variables for its length", and naming what is still needed reads better to
-- a parent anyway.
update public.message_templates
   set body_preview = E'Hi {{1}}, before {{2}} starts at {{3}} on {{4}} we still need a few things from you: {{5}}. Tap below to finish — it only takes a few minutes.'
 where key = 'onboarding_outstanding';
