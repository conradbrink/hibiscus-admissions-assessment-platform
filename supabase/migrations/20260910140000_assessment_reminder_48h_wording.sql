-- The 48-hour reminder ended on a variable: "... is on {{4}} at {{5}}." A
-- template whose wording stops at a placeholder is refused before it reaches
-- Meta, and the trailing full stop does not count as words. It now closes on
-- the sentence its button already promised, so the row previews what Meta
-- approved.
update message_templates
set body_preview = 'Hi {{1}}, a reminder that {{2}}''s assessment at {{3}} is on {{4}} at {{5}}. Tap below to see the details.',
    updated_at = now()
where key = 'assessment_reminder_48h'
  and body_preview = 'Hi {{1}}, a reminder that {{2}}''s assessment at {{3}} is on {{4}} at {{5}}.';
