-- Meta refused the day-of reminder: "This template has too many variables for
-- its length." Four variables carried by forty-nine characters of wording is
-- mostly blanks, and the reviewer reads that as a template that could say
-- anything. The same four values now sit in a sentence, which is also the
-- sentence a parent standing outside the wrong campus needs.
update message_templates
set body_preview = 'Hi {{1}}, this is a quick reminder that {{2}} is expected for an assessment with us today at {{3}}, at our {{4}} campus. Tap below to see the details and how to find us.',
    updated_at = now()
where key = 'assessment_reminder_day'
  and body_preview = 'Hi {{1}}, {{2}}''s assessment is today at {{3}}, {{4}}. See you there.';
