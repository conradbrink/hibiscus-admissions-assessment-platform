-- Zavu addresses a WhatsApp template by its own id.
--
-- Third identifier for the same approved wording, and the same reason as the
-- second: Meta takes the template's name, Twilio the SID of the Content
-- Template wrapping it, Zavu the id of the template in its own console. None
-- is derivable from the others, and a school moving between providers keeps
-- more than one until it is sure.
--
-- The send path reads whichever column the live provider names, and skips a
-- template that has not been given it, with that reason recorded. No shape
-- check here: unlike Twilio's `HX…`, Zavu's id has no documented form, and a
-- constraint guessing at one would refuse something valid.

alter table public.message_templates
  add column if not exists zavu_template_id text;

comment on column public.message_templates.zavu_template_id is
  'Zavu''s id for this template, from its console. Needed only when MESSAGING_PROVIDER=zavu; the Meta name or the Twilio SID is used instead when one of those is in front.';
