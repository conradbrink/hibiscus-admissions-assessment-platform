-- A link that reaches a family, not one application.
--
-- `web/AGENTS.md` has said since the first commit that a parent session is
-- scoped to exactly one application. That was right for a two-month funnel
-- about one child: the parent enquires, books, reads a result, accepts an
-- offer, pays, registers, and is done.
--
-- It does not survive what comes next. A family is with the school for eight
-- years, with two or three children at once, and everything the CRM asks of
-- them — finish the checklist, confirm your details, tell us whether they are
-- coming back — is asked of the family, not of an application that closed
-- years ago. Minting a link per application would mean three links in one
-- email and a parent picking the right child before they can answer.
--
-- So a token now names one subject: an application (as before) or a family.
-- The school's owner agreed the change on 10 September 2026; the rule in
-- AGENTS.md is amended in the same commit rather than quietly broken.
--
-- Parents are still not database principals. There are no parent accounts,
-- no parent JWTs and no parent RLS: a family link is exchanged for a signed
-- cookie under its own HMAC domain, and every read goes through the loaders
-- in `lib/family/scope.ts`, which take the session and never a raw id.

alter table public.access_tokens
  alter column application_id drop not null;

alter table public.access_tokens
  add column if not exists family_id uuid references public.families(id) on delete cascade;

create index if not exists access_tokens_family_idx
  on public.access_tokens(family_id, purpose) where family_id is not null;

-- Every live row has an application and one of the six original purposes, so
-- widening the check is safe. The five new purposes are the family's.
alter table public.access_tokens drop constraint if exists access_tokens_purpose_check;
alter table public.access_tokens add constraint access_tokens_purpose_check check (purpose in (
  'next_step', 'booking', 'results', 'offer', 'payment', 'registration',
  'family', 'onboarding', 'reenrolment', 'checkin', 'event'
));

-- Exactly one subject, and the purpose decides which. A `payment` link with a
-- family on it, or a `reenrolment` link with an application, is a bug we would
-- rather meet here than in a route that reads the wrong column.
alter table public.access_tokens drop constraint if exists access_tokens_subject_check;
alter table public.access_tokens add constraint access_tokens_subject_check check (
  case
    when purpose in ('family', 'onboarding', 'reenrolment', 'checkin', 'event')
      then family_id is not null and application_id is null
    else application_id is not null and family_id is null
  end
);

comment on column public.access_tokens.family_id is
  'The family a link is for, when its purpose is a family one. Exactly one of application_id and family_id is set; the purpose says which.';

-- ---------------------------------------------------------------------------
-- Consuming a token, now that it may name either
-- ---------------------------------------------------------------------------

-- The return type has to widen, and Postgres refuses `create or replace`
-- across that. Dropping and recreating is not an option either: migrations
-- run before the deploy, so the old code would call a function that no longer
-- exists for the length of it, and every parent link would 500.
--
-- So the work moves to a new function and the old name becomes a thin wrapper
-- over it. One implementation, no window. `consume_token` can be dropped a
-- release after the deploy that stops calling it.
create or replace function public.consume_token_v2(
  p_token_hash text,
  p_ip_hash text,
  p_user_agent text
)
returns table (outcome text, application_id uuid, family_id uuid, purpose text, token_id uuid)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  t public.access_tokens%rowtype;
  v_outcome text;
begin
  select * into t from public.access_tokens where token_hash = p_token_hash for update;
  if not found then
    return query select 'unknown'::text, null::uuid, null::uuid, null::text, null::uuid;
    return;
  end if;

  if t.revoked_at is not null then
    v_outcome := 'revoked';
  elsif t.expires_at < now() then
    v_outcome := 'expired';
  elsif t.max_uses is not null and t.use_count >= t.max_uses then
    v_outcome := 'exhausted';
  else
    v_outcome := 'ok';
    update public.access_tokens set use_count = use_count + 1 where id = t.id;
  end if;

  insert into public.token_uses (token_id, ip_hash, user_agent, outcome)
  values (t.id, p_ip_hash, left(p_user_agent, 300), v_outcome);

  return query select
    v_outcome,
    case when v_outcome = 'ok' then t.application_id end,
    case when v_outcome = 'ok' then t.family_id end,
    case when v_outcome = 'ok' then t.purpose end,
    t.id;
end;
$$;

revoke execute on function public.consume_token_v2(text, text, text) from public, anon, authenticated;

comment on function public.consume_token_v2(text, text, text) is
  'Verifies and consumes a magic link, returning whichever subject it names. consume_token is a wrapper kept for the length of one deploy.';

create or replace function public.consume_token(
  p_token_hash text,
  p_ip_hash text,
  p_user_agent text
)
returns table (outcome text, application_id uuid, purpose text, token_id uuid)
language sql
security invoker
set search_path = public, pg_temp
as $$
  select v.outcome, v.application_id, v.purpose, v.token_id
    from public.consume_token_v2(p_token_hash, p_ip_hash, p_user_agent) v
$$;

revoke execute on function public.consume_token(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Staff can see that a family link exists
-- ---------------------------------------------------------------------------

-- The applicant profile already shows "link sent, valid until". The family
-- record wants the same, so the policy grows a second arm rather than leaving
-- family links invisible. The hash is still useless to a reader and the raw
-- token is not in the database at all.
drop policy if exists access_tokens_select on public.access_tokens;
create policy access_tokens_select on public.access_tokens
  for select using (
    exists (
      select 1 from public.applications a
      where a.id = access_tokens.application_id
        and (select public.has_permission('applications.read'))
        and (select public.can_access_campus(a.campus_id))
    )
    or exists (
      select 1 from public.students s
      where s.family_id = access_tokens.family_id
        and (select public.has_permission('students.read'))
        and (select public.can_access_campus(s.current_campus_id))
    )
  );

drop policy if exists token_uses_select on public.token_uses;
create policy token_uses_select on public.token_uses
  for select using (
    exists (
      select 1
      from public.access_tokens t
      where t.id = token_uses.token_id
        and (
          exists (
            select 1 from public.applications a
            where a.id = t.application_id
              and (select public.has_permission('applications.read'))
              and (select public.can_access_campus(a.campus_id))
          )
          or exists (
            select 1 from public.students s
            where s.family_id = t.family_id
              and (select public.has_permission('students.read'))
              and (select public.can_access_campus(s.current_campus_id))
          )
        )
    )
  );

-- How long a family session lives. Longer than the funnel's hour: the
-- details-refresh form is a dozen questions on a phone, and being timed out
-- half way through it is how a parent gives up.
insert into public.settings (key, value, description) values
  ('family_session_minutes', '120', 'Minutes a family magic-link session lasts before the parent needs a fresh link.')
on conflict (key) do nothing;
