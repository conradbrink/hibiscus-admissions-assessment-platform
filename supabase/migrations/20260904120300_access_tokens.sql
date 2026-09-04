-- Magic-link tokens, and the rate limiter that protects them.
--
-- A parent never has an account. Every email they receive carries a link
-- like /a/<token>; the token is 32 random bytes, and only its SHA-256 hash is
-- stored here. Possession of the database therefore does not give possession
-- of any parent's link.
--
-- The application code exchanges a valid token for a short-lived signed
-- cookie scoped to one application, so the token appears in a URL exactly
-- once. See web/lib/tokens.

create table if not exists public.access_tokens (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  purpose text not null check (purpose in (
    'next_step', 'booking', 'results', 'offer', 'payment', 'registration'
  )),
  token_hash text not null unique,
  expires_at timestamptz not null,
  -- Null means unlimited within the expiry, which is right for "your next
  -- step": a parent opens that link from three devices over a fortnight.
  max_uses int check (max_uses is null or max_uses > 0),
  use_count int not null default 0,
  revoked_at timestamptz,
  created_reason text,
  created_at timestamptz not null default now()
);

create index if not exists access_tokens_application_idx
  on public.access_tokens(application_id, purpose);

comment on table public.access_tokens is
  'Magic-link tokens. Only the hash is stored; the raw token exists in the email and nowhere else.';

create table if not exists public.token_uses (
  id bigint generated always as identity primary key,
  token_id uuid not null references public.access_tokens(id) on delete cascade,
  used_at timestamptz not null default now(),
  -- Hashed with a server-side salt before it gets here. Enough to see "three
  -- attempts from the same place", not enough to identify the place.
  ip_hash text,
  user_agent text,
  outcome text not null check (outcome in ('ok', 'expired', 'revoked', 'exhausted'))
);

create index if not exists token_uses_token_idx on public.token_uses(token_id, used_at desc);

-- Verify and consume in one statement, so two simultaneous uses of a
-- single-use token cannot both read "0 of 1" and both succeed. Unknown hashes
-- are not recorded — there is no token row to hang the record on, and the
-- rate limiter is what defends against guessing.
create or replace function public.consume_token(
  p_token_hash text,
  p_ip_hash text,
  p_user_agent text
)
returns table (outcome text, application_id uuid, purpose text, token_id uuid)
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
    return query select 'unknown'::text, null::uuid, null::text, null::uuid;
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
    case when v_outcome = 'ok' then t.purpose end,
    t.id;
end;
$$;

revoke execute on function public.consume_token(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Rate limiting
-- ---------------------------------------------------------------------------

-- Counting happens here rather than in a route handler because serverless
-- instances come and go and an in-memory tally resets on every cold start.
-- One row per (bucket, subject, window), incremented atomically.
--
-- The subject is supplied by the caller — a hashed IP, a normalised email —
-- because the callers being protected are anonymous parents with no session
-- to derive one from.
create table if not exists public.rate_limits (
  bucket text not null,
  subject text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (bucket, subject, window_start)
);

create or replace function public.consume_rate_limit(
  p_bucket text,
  p_subject text,
  p_limit int,
  p_window_seconds int,
  p_cost int default 1
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_window timestamptz := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );
  v_count int;
begin
  insert into public.rate_limits (bucket, subject, window_start, count)
  values (p_bucket, p_subject, v_window, p_cost)
  on conflict (bucket, subject, window_start)
    do update set count = public.rate_limits.count + p_cost
  returning count into v_count;

  return jsonb_build_object(
    'allowed', v_count <= p_limit,
    'remaining', greatest(p_limit - v_count, 0),
    'retry_after_seconds',
      greatest(ceil(extract(epoch from (v_window + make_interval(secs => p_window_seconds) - now())))::int, 1)
  );
end;
$$;

revoke execute on function public.consume_rate_limit(text, text, int, int, int) from public, anon, authenticated;

-- Windows older than a day are noise. Called by the job drain.
create or replace function public.prune_rate_limits()
returns int
language sql
security invoker
set search_path = public
as $$
  with deleted as (
    delete from public.rate_limits
    where window_start < now() - interval '1 day'
    returning 1
  )
  select count(*)::int from deleted
$$;

revoke execute on function public.prune_rate_limits() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.access_tokens enable row level security;
alter table public.token_uses enable row level security;
alter table public.rate_limits enable row level security;

-- Staff can see that a link exists and when it expires — the applicant's
-- profile shows "link sent, valid until". The hash is useless to them, and
-- the raw token is not in the database at all.
drop policy if exists access_tokens_select on public.access_tokens;
create policy access_tokens_select on public.access_tokens
  for select using (
    exists (
      select 1 from public.applications a
      where a.id = access_tokens.application_id
        and (select public.has_permission('applications.read'))
        and (select public.can_access_campus(a.campus_id))
    )
  );

drop policy if exists token_uses_select on public.token_uses;
create policy token_uses_select on public.token_uses
  for select using (
    exists (
      select 1
      from public.access_tokens t
      join public.applications a on a.id = t.application_id
      where t.id = token_uses.token_id
        and (select public.has_permission('applications.read'))
        and (select public.can_access_campus(a.campus_id))
    )
  );

-- Minting and revoking are service-role operations via server actions. No
-- insert, update or delete for authenticated on either table.
-- rate_limits: RLS on, zero policies, service role only.
