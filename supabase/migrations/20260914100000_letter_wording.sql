-- ---------------------------------------------------------------------------
-- What the letters say: no assessment for pre-school, and pay by name
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The offer letter
-- ---------------------------------------------------------------------------

-- Two corrections and they land in one new version, because a template is
-- versioned and an offer already sent keeps the version it was rendered with.
--
-- 1. "passed the intake assessment" opened every offer, including the ones to
--    pre-school families whose child was never asked to sit one. The template
--    language has {{#if}} and no {{#else}} (lib/email/render.ts), so the
--    sentence is guarded on `assessed` and simply drops out for the pre-school
--    track — the congratulation and the offer itself are shared.
--
-- 2. The payment reference is the child's name. The /pay page has said so for
--    a while and the letter still named the application reference, so a family
--    was told two different things depending on which they were looking at.
--    `reference_to_use` is the same value both now read.
--
-- The application reference stays on the letter, named as what it is, because
-- it is what the office quotes back and what finance reconciles on.
-- One active template per key is enforced by an index, so the outgoing one
-- steps aside before the new one arrives.
update public.offer_templates set is_active = false, updated_at = now()
 where key = 'standard' and is_active
   and not exists (select 1 from public.offer_templates x where x.key = 'standard' and x.version = 8);

insert into public.offer_templates (key, version, name, body_html, terms_html, allowed_variables, is_active)
select
  'standard',
  8,
  t.name,
  replace(
    replace(
      replace(
        t.body_html,
        '<p>Congratulations! <strong>{{student_first_name}} {{student_last_name}}</strong> passed the intake assessment. We are happy to offer {{student_first_name}} a place',
        '<p>Congratulations!{{#if assessed}} <strong>{{student_first_name}} {{student_last_name}}</strong> passed the intake assessment.{{/if}} We are happy to offer <strong>{{student_first_name}} {{student_last_name}}</strong> a place'
      ),
      'Please use the reference {{application_reference}} when you pay.',
      'Please use the reference <strong>{{reference_to_use}}</strong> — the child''s name — when you pay.'
    ),
    'This offer is open until <strong>{{offer_expiry_date}}</strong>. Reference: {{application_reference}}.',
    'This offer is open until <strong>{{offer_expiry_date}}</strong>. Application reference: {{application_reference}}.'
  ),
  t.terms_html,
  t.allowed_variables || array['assessed', 'reference_to_use'],
  true
from public.offer_templates t
where t.key = 'standard' and t.version = 7
  and not exists (select 1 from public.offer_templates x where x.key = 'standard' and x.version = 8);

update public.offer_templates set is_active = true, updated_at = now()
 where key = 'standard' and version = 8 and not is_active;

-- The replacements are exact strings, so a template someone has since edited
-- would silently copy forward unchanged. Fail loudly instead: a letter that
-- still congratulates a pre-school child on an assessment is the whole point.
do $$
declare
  v_body text;
begin
  select body_html into v_body from public.offer_templates where key = 'standard' and version = 8;
  if v_body is null then
    raise exception 'offer template v8 was not created';
  end if;
  if position('{{#if assessed}}' in v_body) = 0 then
    raise exception 'offer template v8 still states the assessment unconditionally';
  end if;
  if position('{{reference_to_use}}' in v_body) = 0 then
    raise exception 'offer template v8 still names the application reference for payment';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The payment emails
-- ---------------------------------------------------------------------------

-- The same reference, in the three emails that ask a family to pay. Each is
-- versioned the same way and the previous version is retired, so anything
-- already sent still reads back as it was sent.
-- Insert dormant, then switch over: one active version per key is enforced by
-- an index, and the migration runner commits between statements, so a temp
-- table does not survive and a single update cannot cross over in place.
insert into public.email_templates (key, version, name, description, subject, body_html, body_text, allowed_variables, is_active, audience)
select
  t.key,
  t.version + 1,
  t.name,
  t.description,
  t.subject,
  replace(replace(t.body_html,
    'Please use the reference {{application_reference}} so we can match your payment.',
    'Please use the reference {{reference_to_use}} — your child''s name — so we can match your payment.'),
    'Please use the reference {{application_reference}}.',
    'Please use the reference {{reference_to_use}} — your child''s name.'),
  replace(replace(t.body_text,
    'Please use the reference {{application_reference}} so we can match your payment.',
    'Please use the reference {{reference_to_use}} — your child''s name — so we can match your payment.'),
    'Please use the reference {{application_reference}}.',
    'Please use the reference {{reference_to_use}} — your child''s name.'),
  t.allowed_variables || array['reference_to_use'],
  false,
  t.audience
from public.email_templates t
where t.is_active
  and t.key in ('offer_accepted_pay', 'payment_failed', 'payment_reminder')
  and not exists (
    select 1 from public.email_templates x where x.key = t.key and x.version = t.version + 1
  );

update public.email_templates set is_active = false, updated_at = now()
 where key in ('offer_accepted_pay', 'payment_failed', 'payment_reminder') and is_active;

update public.email_templates e set is_active = true, updated_at = now()
 where e.key in ('offer_accepted_pay', 'payment_failed', 'payment_reminder')
   and e.version = (select max(x.version) from public.email_templates x where x.key = e.key);

do $$
declare
  v_stale text;
begin
  select string_agg(key, ', ' order by key) into v_stale
    from public.email_templates
   where is_active
     and key in ('offer_accepted_pay', 'payment_failed', 'payment_reminder')
     and body_text like '%reference {{application_reference}}%';
  if v_stale is not null then
    raise exception 'these payment emails still ask for the application reference: %', v_stale;
  end if;
end $$;
