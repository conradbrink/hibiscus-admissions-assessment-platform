-- Let the WhatsApp templates name the number somebody actually reads.
--
-- Two of them currently tell a parent to do the wrong thing outright:
--
--   offer_accepted_pay  "Tap below to pay, or reply here if you would
--                        rather arrange a transfer."
--   talk_to_us          "...message us here or call {{4}}."
--
-- "Here" is a number nobody reads. At the two moments a parent most needs
-- an answer — securing a place, and asking for help — we send them into
-- silence and then wonder why they think it is a chat line. They are doing
-- exactly what they were told.
--
-- The wording itself lives at Meta and can only change when Meta approves a
-- new version, which is slow and is the school's to do. What this migration
-- does is remove the obstacle on our side: `campus_whatsapp` has to be in a
-- template's allow-list before the console will let anyone save it as a
-- variable, and today it is missing from every one of these. Adding it
-- changes no wording and sends nothing differently — it only means that the
-- moment an approval comes back, the id and the sixth variable can be
-- entered without a deploy standing in the way.
--
-- The number is per campus (Botswana and Potchefstroom have different manned
-- lines), so it must be a variable and cannot be baked into the wording.
--
-- `campus_phone` comes along for the same reason it does in the emails: some
-- parents would rather ring, and a template that names one number and not the
-- other forces a choice we do not need to make yet.

update email_templates
set allowed_variables = (
      select array_agg(distinct v order by v)
      from unnest(allowed_variables || array['campus_whatsapp', 'campus_phone']) as v
    ),
    updated_at = now()
where is_active
  and key in (
    -- Telling parents to reply to an unmanned number. These are the two to
    -- resubmit first.
    'offer_accepted_pay',
    'talk_to_us',
    -- The first thing a family receives on each track: say it once, early.
    'enquiry_received',
    'preschool_enquiry_received',
    'callback_received',
    -- The confirmations a parent answers with "thank you" or "can we move
    -- it?" — the replies actually sitting unread in the provider's inbox.
    'booking_confirmed',
    'playdate_confirmed',
    'visit_confirmed',
    -- An offer is the message a parent most wants to reply to.
    'preschool_offer',
    'results_and_offer'
  );
