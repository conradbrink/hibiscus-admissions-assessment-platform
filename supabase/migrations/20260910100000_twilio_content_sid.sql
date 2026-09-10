-- Twilio addresses a WhatsApp template by SID, not by name.
--
-- Meta's Cloud API takes the approved template's name and a language. Twilio
-- wraps the same approved template in a **Content Template** of its own with
-- a SID (`HX…`), and the variables go as one JSON object keyed "1", "2".
-- Neither identifier is derivable from the other: the SID is minted by Twilio
-- when the content is created, and a school moving between the two keeps both
-- until it is sure.
--
-- So a template row carries both, and each adapter reads its own column. A
-- template with nothing in the column the live provider needs is skipped by
-- the send path with that reason recorded, exactly as a template with no Meta
-- name is today — never sent half-configured.

alter table public.message_templates
  add column if not exists twilio_content_sid text;

comment on column public.message_templates.twilio_content_sid is
  'Twilio''s Content Template SID (HX…) for this message, from the Twilio console. Needed only when MESSAGING_PROVIDER=twilio; the Meta name is used instead when the Cloud API is in front.';

-- A SID is a fixed shape, and a pasted-in name or a truncated copy is the
-- kind of thing that fails once, in production, at the first send.
alter table public.message_templates
  drop constraint if exists message_templates_twilio_content_sid_check;

alter table public.message_templates
  add constraint message_templates_twilio_content_sid_check
  check (twilio_content_sid is null or twilio_content_sid ~ '^HX[0-9a-fA-F]{32}$');
