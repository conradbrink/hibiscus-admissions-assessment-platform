-- ---------------------------------------------------------------------------
-- The fees reminder ends with "ignore this if you have already paid"
-- ---------------------------------------------------------------------------

-- The school asked on 10 October 2026 for every payment reminder to say, at
-- the bottom, that a parent who has paid can ignore it. Parents who paid were
-- worried by the reminder that followed.
--
-- The email already had a line about it, but only for bank transfers and in
-- the middle of the message, above the reference. A parent who paid by card
-- the same morning, before the gateway confirmed, read it as "this is not
-- for you". The line now covers any payment and is the last thing before the
-- sign-off.
--
-- Built from the active version with replace() rather than restated, so a
-- wording change an administrator published from the console is kept. The
-- WhatsApp companion's wording lives at Meta and changes only when a new
-- version is approved; web/content/messaging/zavu-templates.json carries the
-- new text for that submission.
--
-- Insert dormant, then switch over: one active version per key is enforced by
-- an index, and the migration runner commits between statements.
insert into public.email_templates (key, version, name, description, subject, body_html, body_text, allowed_variables, is_active, audience)
select
  t.key,
  t.version + 1,
  t.name,
  t.description,
  t.subject,
  replace(replace(t.body_html,
    '<p>If you have already paid by bank transfer, please ignore this email; we will confirm as soon as the payment reaches us.</p>', ''),
    '<p>Hibiscus International Schools Admissions</p>',
    '<p>If you have already paid, please ignore this reminder. We will confirm as soon as your payment reaches us.</p>'
      || '<p>Hibiscus International Schools Admissions</p>'),
  replace(replace(t.body_text,
    E'If you have already paid by bank transfer, please ignore this email; we will confirm as soon as the payment reaches us.\n\n', ''),
    'Hibiscus International Schools Admissions',
    E'If you have already paid, please ignore this reminder. We will confirm as soon as your payment reaches us.\n\nHibiscus International Schools Admissions'),
  t.allowed_variables,
  false,
  t.audience
from public.email_templates t
where t.is_active
  and t.key = 'payment_reminder'
  and t.body_text not like '%If you have already paid, please ignore this reminder.%'
  and not exists (
    select 1 from public.email_templates x where x.key = t.key and x.version = t.version + 1
  );

update public.email_templates set is_active = false, updated_at = now()
 where key = 'payment_reminder' and is_active
   and version < (select max(x.version) from public.email_templates x where x.key = 'payment_reminder');

update public.email_templates e set is_active = true, updated_at = now()
 where e.key = 'payment_reminder'
   and e.version = (select max(x.version) from public.email_templates x where x.key = e.key);

do $$
begin
  if not exists (
    select 1 from public.email_templates
     where key = 'payment_reminder' and is_active
       and body_text like E'%If you have already paid, please ignore this reminder.%\n\nHibiscus International Schools Admissions'
       and body_html like '%<p>If you have already paid, please ignore this reminder.%</p><p>Hibiscus International Schools Admissions</p>%'
  ) then
    raise exception 'payment_reminder does not end with the already-paid line';
  end if;
  if exists (
    select 1 from public.email_templates
     where key = 'payment_reminder' and is_active and body_text like '%paid by bank transfer, please ignore%'
  ) then
    raise exception 'payment_reminder still carries the old bank-transfer-only line';
  end if;
end $$;
