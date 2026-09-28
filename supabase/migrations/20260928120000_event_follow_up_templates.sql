-- The event follow-up, as three WhatsApp templates any campus can send.
--
-- A family that came to an open day is thanked, offered a free one-week
-- trial, reminded, and told once about the deadline. The wording names no
-- campus, no event and no child: the parent's first name, the event and the
-- campus are campaign variables, the child is "your child", and the link is
-- the universal /join page. So the same three approved templates serve Bana
-- Tlokweng today and Block 7 primary and secondary next time.
--
-- Meta approves each as a MARKETING template through Zavu; until an id is
-- recorded on the row it stays inactive and a campaign that names it skips
-- its WhatsApp recipients with a reason. `deadline` is not a campaign
-- variable: the campaign's `whatsapp_variables` carries it as a literal.

insert into public.message_templates (key, name, language, body_preview, parameters, button_link, link_purpose, is_active, audience)
values
  ('event_thank_you', 'Event: thank you and the free week', 'en',
   'Hi {{1}}, thank you for coming to our {{2}}. It was lovely to meet you and your child. If you would like to see what a week with us is like, your child is welcome to a free one-week trial at Hibiscus {{3}}. Book it here: https://admissions.hibiscus.co.bw/join. The Hibiscus Team',
   array['parent_first_name','event_name','campus'], false, 'event', false, 'family'),
  ('event_free_trial_reminder', 'Event: free trial week reminder', 'en',
   'Hi {{1}}, your child''s free one-week trial at Hibiscus {{2}} is still open after our {{3}}. Booking takes two minutes: https://admissions.hibiscus.co.bw/join. We would love to have you both.',
   array['parent_first_name','campus','event_name'], false, 'event', false, 'family'),
  ('event_free_trial_last_call', 'Event: last message with the deadline', 'en',
   'Hi {{1}}, this is our last note about our {{2}}. Enrol your child at Hibiscus {{3}} by {{4}} and they get a free Hibiscus Welcome Pack. Want to try us first? Book a free one-week trial here: https://admissions.hibiscus.co.bw/join. We would love to welcome your family to Hibiscus.',
   array['parent_first_name','event_name','campus','deadline'], false, 'event', false, 'family')
on conflict (key) do nothing;

-- The email side of each moment. Campaigns carry their own email wording, so
-- these rows are the companions the coverage suite asks for and a starting
-- point for an automation; they stay inactive until somebody wants an
-- automation to send them.
insert into public.email_templates (key, version, name, description, subject, body_text, body_html, allowed_variables, is_active, audience)
values
  ('event_thank_you', 1, 'Event: thank you and the free week',
   'The email side of the event follow-up. Campaigns carry their own wording; inactive until an automation needs it.',
   'A free week for your child',
   E'Dear {{parent_first_name}},\n\nThank you again for coming to our {{event_name}}.\n\nYour child is invited to a free one-week trial at Hibiscus {{campus}}. They join a class, meet the teachers and follow a normal school day. You see how they settle before you decide.\n\nBook the free week here:\nhttps://admissions.hibiscus.co.bw/join\n\nWarm regards,\nHibiscus {{campus}}',
   '<p>Dear {{parent_first_name}},</p><p>Thank you again for coming to our {{event_name}}.</p><p>Your child is invited to a free one-week trial at Hibiscus {{campus}}. They join a class, meet the teachers and follow a normal school day. You see how they settle before you decide.</p><p>Book the free week here:<br>https://admissions.hibiscus.co.bw/join</p><p>Warm regards,<br>Hibiscus {{campus}}</p>',
   array['parent_first_name','event_name','campus'], false, 'family'),
  ('event_free_trial_reminder', 1, 'Event: free trial week reminder',
   'The email side of the reminder. Campaigns carry their own wording; inactive until an automation needs it.',
   'Your child''s free week is still open',
   E'Dear {{parent_first_name}},\n\nYour child''s free one-week trial at Hibiscus {{campus}} is still open after our {{event_name}}.\n\nBooking takes two minutes:\nhttps://admissions.hibiscus.co.bw/join\n\nWe would love to have you both.\n\nWarm regards,\nHibiscus {{campus}}',
   '<p>Dear {{parent_first_name}},</p><p>Your child''s free one-week trial at Hibiscus {{campus}} is still open after our {{event_name}}.</p><p>Booking takes two minutes:<br>https://admissions.hibiscus.co.bw/join</p><p>We would love to have you both.</p><p>Warm regards,<br>Hibiscus {{campus}}</p>',
   array['parent_first_name','event_name','campus'], false, 'family'),
  ('event_free_trial_last_call', 1, 'Event: last message with the deadline',
   'The email side of the last message. Campaigns carry their own wording and the deadline; inactive until an automation needs it.',
   'A welcome gift for your child',
   E'Dear {{parent_first_name}},\n\nThis is our last note about our {{event_name}}. Children who enrol at Hibiscus {{campus}} before the deadline get a free Hibiscus Welcome Pack.\n\nNot sure yet? Start with the free week. Your child tries a real school week, and you decide after.\n\nBook the free week here:\nhttps://admissions.hibiscus.co.bw/join\n\nWarm regards,\nHibiscus {{campus}}',
   '<p>Dear {{parent_first_name}},</p><p>This is our last note about our {{event_name}}. Children who enrol at Hibiscus {{campus}} before the deadline get a free Hibiscus Welcome Pack.</p><p>Not sure yet? Start with the free week. Your child tries a real school week, and you decide after.</p><p>Book the free week here:<br>https://admissions.hibiscus.co.bw/join</p><p>Warm regards,<br>Hibiscus {{campus}}</p>',
   array['parent_first_name','event_name','campus'], false, 'family')
on conflict do nothing;
