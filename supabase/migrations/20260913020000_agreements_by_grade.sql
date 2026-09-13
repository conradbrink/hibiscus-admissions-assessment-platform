-- Which agreements an applicant is asked for, and which of them may be refused.
--
-- Two things were wrong with the registration agreements step, both of them
-- visible to a parent.
--
-- The learner code of conduct went to everybody. It is a code a *learner*
-- reads and signs up to — uniform, homework, conduct in class — and a family
-- registering a baby, a toddler or a Grade RR child was being asked to accept
-- rules that have nothing to say about their child. `agreement_templates` had
-- no grade scoping at all, while `document_requirements` has solved exactly
-- this since Phase 3. The columns below are that table's, deliberately: same
-- names, same nullable-means-no-bound meaning, so the filter reads the same in
-- both places (`applicableRequirements` and `applicableAgreements`, side by
-- side in web/lib/registration/completeness.ts).
--
-- And the photographs and social media agreement could be skipped. It is the
-- one document in the set where the school actually needs an answer from every
-- family — it decides whether a child appears in a newsletter or on Facebook —
-- and it was the only one with `required = false`. Silence was being read as a
-- yes.
--
-- The school's decision is that it must be **answered**, not agreed. That is
-- the difference between consent and a formality: a permission nobody may
-- refuse is not a permission, and what the office needs is the short list of
-- children who may not be photographed, not a hundred per cent acceptance rate
-- that tells it nothing.

-- ---------------------------------------------------------------------------
-- Grade scoping, and refusable consent
-- ---------------------------------------------------------------------------

alter table public.agreement_templates
  add column if not exists grade_sort_min integer,
  add column if not exists grade_sort_max integer,
  add column if not exists may_decline boolean not null default false;

comment on column public.agreement_templates.grade_sort_min is
  'Lowest grades.sort_order this agreement applies to; null means no lower bound. Same shape as document_requirements.';
comment on column public.agreement_templates.grade_sort_max is
  'Highest grades.sort_order this agreement applies to; null means no upper bound.';
comment on column public.agreement_templates.may_decline is
  'Whether a parent may refuse this and still finish registering. With required = true it means the answer is compulsory but the consent is not: they must choose, and either choice lets them continue.';

-- The two flags together are the whole model, and each pairing is something
-- the school already has:
--
--   required  may_decline  what the parent sees
--   --------  -----------  -------------------------------------------------
--   true      false        one tick, and they cannot continue without it
--   true      TRUE         Agree or Decline, and they must pick one
--   false     -            may be skipped entirely (nothing uses this today)

-- ---------------------------------------------------------------------------
-- Recording a refusal
-- ---------------------------------------------------------------------------

-- The table is still called `agreement_acceptances` while now holding some
-- rows that are the opposite of an acceptance. That is a poor name and it is
-- deliberately not being fixed here: renaming it would touch the workflow
-- engine, the staff console, the records PDF and the security suite, none of
-- which this change is about. The column carries the meaning.
--
-- `accepted` is the default so that every insert written before today stays
-- correct without being edited, and so that a future one that forgets the
-- column records the safe, ordinary case rather than a null.
alter table public.agreement_acceptances
  add column if not exists decision text not null default 'accepted';

alter table public.agreement_acceptances
  drop constraint if exists agreement_acceptances_decision_check;
alter table public.agreement_acceptances
  add constraint agreement_acceptances_decision_check
  check (decision in ('accepted', 'declined'));

comment on column public.agreement_acceptances.decision is
  'accepted or declined. A declined row is still a signed, timestamped answer — it is the record that this family said no, which is the whole reason the question is compulsory.';

-- ---------------------------------------------------------------------------
-- The two agreements this was for
-- ---------------------------------------------------------------------------

-- Stage 1 is the first primary year (grades.sort_order 60). Everything below
-- it is pre-school: Babies 1, Toddlers 2, Junior 3, Grade RR 4, Grade R 5,
-- Nursery 10, Pre-Kindergarten 20, Kindergarten 30, Pre-Reception 40 and
-- Reception 50 — Reception included, because it is taught at the pre-school
-- campuses.
--
-- Both versions are set, the retired v1 as well as the live v2, so that
-- bringing an old one back cannot quietly bring the old scope with it.
update public.agreement_templates
   set grade_sort_min = 60, updated_at = now()
 where key = 'learner_code_of_conduct';

-- Compulsory to answer, free to refuse, and sitting after the four numbered
-- agreements rather than at the default 100.
update public.agreement_templates
   set required = true, may_decline = true, sort_order = 50, updated_at = now()
 where key = 'photography_consent';

-- ---------------------------------------------------------------------------
-- Publishing new wording must not quietly change who is asked
-- ---------------------------------------------------------------------------

-- `publish_agreement_template` retires the active version and inserts a new
-- one, naming its columns explicitly. Left alone, the two columns added above
-- would not be among them, so the new row would come back with
-- `grade_sort_min = null` and `may_decline = false` — and editing a typo in
-- the learner code of conduct would put it back in front of every pre-school
-- family, while re-publishing the photographs consent would turn it from a
-- question into a demand.
--
-- Nothing would look wrong. The school would have changed a sentence and
-- silently changed the policy.
--
-- So the new version inherits the scope of the one it replaces. Wording and
-- scope are different decisions, and this function is the one that edits
-- wording: changing who is asked is done on the agreements screen, against
-- the live version, and does not mint a version nobody's wording differs in.
create or replace function public.publish_agreement_template(
  p_key text,
  p_name text,
  p_description text,
  p_body_html text,
  p_required boolean,
  p_document_url text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_next int;
  v_id uuid;
  v_grade_min int;
  v_grade_max int;
  v_may_decline boolean;
  v_sort int;
begin
  if not public.has_permission('templates.write') then
    raise exception 'permission_denied';
  end if;
  if p_key !~ '^[a-z0-9_]+$' then
    raise exception 'template_key_invalid';
  end if;
  if p_document_url is not null and p_document_url !~ '^https://' then
    raise exception 'document_url_invalid';
  end if;
  select coalesce(max(version), 0) + 1 into v_next from public.agreement_templates where key = p_key;
  -- The version being replaced decides the scope of the one replacing it. A
  -- brand new agreement has none to inherit, and gets the open defaults.
  select grade_sort_min, grade_sort_max, may_decline, sort_order
    into v_grade_min, v_grade_max, v_may_decline, v_sort
    from public.agreement_templates
   where key = p_key and is_active
   limit 1;
  update public.agreement_templates set is_active = false where key = p_key and is_active;
  insert into public.agreement_templates (key, version, name, description, body_html, required, document_url, is_active, created_by, grade_sort_min, grade_sort_max, may_decline, sort_order)
  values (p_key, v_next, p_name, p_description, p_body_html, p_required, p_document_url, true, auth.uid(), v_grade_min, v_grade_max, coalesce(v_may_decline, false), coalesce(v_sort, 100))
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.publish_agreement_template(text, text, text, text, boolean, text) from public, anon;
grant execute on function public.publish_agreement_template(text, text, text, text, boolean, text) to authenticated;
