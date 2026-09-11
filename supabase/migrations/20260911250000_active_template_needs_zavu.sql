-- An active WhatsApp template needs the id of the provider that is sending.
--
-- `20260905100000_messaging.sql` wrote that as `meta_template_name is not
-- null`, because Meta was the only adapter at the time. Zavu came later, its
-- templates are now approved, and the console asks for a Zavu id alone — so
-- ticking Active on a row with a perfectly good Zavu id was refused by the
-- database with `message_templates_check`, which names nothing a reader could
-- act on. The application-level rule and the constraint had drifted apart,
-- and the constraint was the older half.
--
-- Rewritten to name Zavu, which is what the console now enforces. Widening it
-- to "any of the three" was the alternative and is rejected on purpose: it
-- would let an active template exist that the configured provider cannot
-- address, which is the failure this constraint is here to prevent. A future
-- move back to Meta or Twilio is a real change, and changes the rule with it.

alter table public.message_templates drop constraint if exists message_templates_check;

alter table public.message_templates
  add constraint message_templates_check
  check (not is_active or zavu_template_id is not null);

comment on constraint message_templates_check on public.message_templates is
  'An active template must carry the Zavu template id the sender addresses it by.';

-- No row is affected: every template is inactive, and none has ever been sent.
-- Were one active on a Meta name alone, this would refuse to apply rather than
-- quietly deactivate it, which is the right way round.
