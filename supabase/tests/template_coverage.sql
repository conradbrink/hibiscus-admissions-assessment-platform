-- Every parent-facing email moment must have a WhatsApp companion, be named
-- email-only with a reason, or be named as a known gap.
--
-- `send_email` fires the companion with the *same* template key as the email
-- (`handlers/send-email.ts`). So an email template with no `message_templates`
-- row does not fail, warn, or appear anywhere: the send records
-- `no active message template for "…"` and the parent never hears about that
-- moment on the channel they opted into.
--
-- That is how `what_to_expect` and `offer_accepted_pay` stayed missing until
-- the audit trail made the skips readable — after both had fired at real
-- families. The trail only shows moments that have actually happened, so it
-- under-reports: this check reads the whole surface instead, and found nine
-- more the trail had not reached yet.
--
-- Three lists, and the distinction matters:
--
--   email_only  decided, with a reason. Not a gap.
--   known_gap   a real gap, acknowledged, not yet filled. Reported every run
--               so it stays visible, but does not fail the build — these
--               predate the check and blocking on them would just get the
--               check deleted.
--   neither     fails. A NEW email template cannot be added without somebody
--               deciding which of the two lists it belongs in, which is the
--               whole point.

-- Does this text read the word to somebody who is not being assessed?
--
-- {{#if assessed}} blocks are removed whole, then every remaining {{…}} —
-- variable names and block markers alike — so what is searched is only what a
-- parent actually reads.
create or replace function pg_temp.says_assessment(p_text text) returns boolean
language sql immutable as $$
  select regexp_replace(
           regexp_replace(coalesce(p_text, ''), '\{\{#if assessed\}\}.*?\{\{/if\}\}', '', 'gs'),
           '\{\{[^}]*\}\}', '', 'g'
         ) ilike '%assess%';
$$;

do $$
declare
  v_list text;
  v_count int;
begin
  create temp table if not exists email_only(key text primary key, why text);
  create temp table if not exists known_gap(key text primary key, why text);
  truncate email_only;
  truncate known_gap;

  insert into email_only(key, why) values
    -- A replacement sign-in link. The parent asked for it by email and that is
    -- where it should arrive; putting a credential-bearing link on a second
    -- channel widens where it can be read, for no gain.
    ('fresh_link',         'carries a sign-in link — one channel only, deliberately'),
    -- News a family should not read off a phone notification between other
    -- things. Email, and a call from the campus where the school can manage it.
    ('outcome_declined',   'not news to deliver by notification'),
    ('outcome_waitlisted', 'not news to deliver by notification');

  -- Eight of the nine were filled the same day this check was written: the
  -- school submitted them to Zavu and the rows followed. `offer_expired` is
  -- the one left, and is a genuine decision rather than an oversight — an
  -- offer lapsing is bad news arriving unprompted, which is the same question
  -- as the two outcomes in `email_only` above.
  insert into known_gap(key, why) values
    ('offer_expired', 'the offer lapsed — bad news, same question as the outcomes above');

  -- 1. Undecided keys fail.
  select string_agg(format('  - %s (%s)', t.key, t.name), E'\n' order by t.key), count(*)
    into v_list, v_count
  from public.email_templates t
  where t.is_active
    and t.audience in ('parent', 'family')
    and not exists (select 1 from public.message_templates m where m.key = t.key)
    and not exists (select 1 from email_only e where e.key = t.key)
    and not exists (select 1 from known_gap g where g.key = t.key);

  if v_count > 0 then
    raise exception E'TEMPLATE COVERAGE: % active parent-facing email template(s) nobody has decided about:\n%\n\nEither add a message_templates row in a migration, or add the key to email_only / known_gap in supabase/tests/template_coverage.sql with a reason.', v_count, v_list;
  end if;

  -- 2. A message template with no email moment can never fire, so it sits in
  --    the console looking configurable for ever. Cheaper to get wrong, still
  --    wrong.
  select string_agg(format('  - %s', m.key), E'\n' order by m.key), count(*)
    into v_list, v_count
  from public.message_templates m
  where not exists (select 1 from public.email_templates t where t.key = m.key);

  if v_count > 0 then
    raise exception E'TEMPLATE COVERAGE: % message template(s) have no email moment to accompany, so they can never send:\n%', v_count, v_list;
  end if;

  -- 3. A gap that has since been filled should leave the list, or the list
  --    stops meaning anything.
  select string_agg(format('  - %s', g.key), E'\n' order by g.key), count(*)
    into v_list, v_count
  from known_gap g
  where exists (select 1 from public.message_templates m where m.key = g.key);

  if v_count > 0 then
    raise exception E'TEMPLATE COVERAGE: % key(s) listed as a known gap now have a companion. Remove them from known_gap:\n%', v_count, v_list;
  end if;

  -- 4. The word "assessment" must not reach a family whose child sits none.
  --
  --    A pre-school family read "Thank you for bringing them to the
  --    assessment" under the subject "assessment results", because the outcome
  --    letters were written for the only track that existed when they were
  --    written. Branching them fixed those two; this stops the next one.
  --
  --    Templates on `assessed_only` are unreachable from the pre-school track:
  --    routing never sends them to an application with
  --    `requires_assessment = false` (web/lib/workflow/actions.ts). Everything
  --    else a parent can receive must either not say the word, or say it
  --    inside an {{#if assessed}} block.
  --
  --    Variable names are stripped before the search, so {{assessment_date}}
  --    on a play date and {{#if no_assessment}} on an outcome letter are not
  --    the word — they are never read by anybody.
  create temp table if not exists assessed_only(key text primary key, why text);
  truncate assessed_only;
  insert into assessed_only(key, why) values
    ('enquiry_received',        'the assessed track''s enquiry; pre-school gets preschool_enquiry_received'),
    ('enquiry_nudge',           'chases an unbooked assessment'),
    ('booking_confirmed',       'an assessment is booked'),
    ('what_to_expect',          'what the assessment morning looks like'),
    ('assessment_reminder_48h', 'reminds about an assessment'),
    ('assessment_reminder_day', 'reminds about an assessment'),
    ('assessment_completed',    'sent when an assessment is submitted'),
    ('no_show_reschedule',      'nobody arrived for an assessment'),
    ('rebook_nudge',            'chases a replacement assessment time'),
    ('results_and_offer',       'carries results; pre-school gets preschool_offer');

  select string_agg(format('  - %s (%s)', t.key, t.name), E'\n' order by t.key), count(*)
    into v_list, v_count
  from public.email_templates t
  where t.is_active
    and t.audience in ('parent', 'family')
    and not exists (select 1 from assessed_only a where a.key = t.key)
    and pg_temp.says_assessment(t.subject || ' ' || t.body_text || ' ' || t.body_html);

  if v_count > 0 then
    raise exception E'TEMPLATE COVERAGE: % active parent-facing email template(s) say "assessment" where a pre-school family can read it:\n%\n\nPut the sentence inside {{#if assessed}} with a pre-school sentence beside it, or add the key to assessed_only in supabase/tests/template_coverage.sql if routing can never send it to a pre-school family.', v_count, v_list;
  end if;

  select string_agg(format('  - %s (%s)', m.key, m.name), E'\n' order by m.key), count(*)
    into v_list, v_count
  from public.message_templates m
  -- Inactive ones too: an inactive row is wording waiting for Meta's
  -- approval, and the moment to catch the word is before it is submitted,
  -- not after a parent has read it.
  where not exists (select 1 from assessed_only a where a.key = m.key)
    and pg_temp.says_assessment(m.body_preview);

  if v_count > 0 then
    raise exception E'TEMPLATE COVERAGE: % WhatsApp template(s) say "assessment" where a pre-school family can read it:\n%\n\nWhatsApp has no {{#if}}, so the wording has to be split into its own template — or the key belongs in assessed_only.', v_count, v_list;
  end if;

  -- Passing, with the outstanding gaps printed so they are seen every run.
  select string_agg(format('  - %s — %s', g.key, g.why), E'\n' order by g.key), count(*)
    into v_list, v_count
  from known_gap g;
  if v_count > 0 then
    raise notice E'% parent-facing moment(s) still have no WhatsApp companion:\n%', v_count, v_list;
  end if;

  raise exception 'ALL TEMPLATE COVERAGE CHECKS PASSED';
end $$;
