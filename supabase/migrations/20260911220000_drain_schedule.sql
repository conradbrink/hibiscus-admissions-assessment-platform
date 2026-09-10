-- A five-minute drain that actually runs, and a record that it did.
--
-- The queue has always been meant to drain every five minutes, and
-- `.github/workflows/drain.yml` asks GitHub for exactly that. GitHub does not
-- deliver it: between 7 and 10 September 2026 a `*/5 * * * *` schedule
-- produced 22 runs in 74 hours — one every 3.4 hours, 2.5% of the cadence it
-- claims. Free-tier scheduled workflows are throttled, and nothing in the
-- product said so.
--
-- It has not been an outage because every parent and staff action drains the
-- queue on its way out (`drainSoon()`), so anything traffic queues leaves
-- within seconds. What has been late is everything with no request behind it:
-- a reminder due at 09:00 on a quiet morning, the weekday session generator,
-- the waitlist sweep, the payment reconciliation for a parent who paid and
-- closed the tab.
--
-- So the schedule moves into the database, which is the one piece of this
-- system that is always awake.

-- ---------------------------------------------------------------------------
-- The tick
-- ---------------------------------------------------------------------------

-- Reads its two secrets from the Vault rather than carrying them: a migration
-- is committed to a public repository and a bearer token is not something to
-- write down there. Neither is returned or logged. Until both secrets exist
-- this is a quiet no-op, which is what makes the migration safe to ship before
-- anybody has set them.
create or replace function public.drain_tick()
returns bigint
language plpgsql
security definer
set search_path = public, net, vault
as $$
declare
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'drain_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'drain_cron_secret';
  if v_url is null or v_secret is null then
    -- Deliberately silent. This runs every five minutes; a log line each time
    -- would bury the failures worth reading.
    return null;
  end if;
  select net.http_get(
    url := v_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 55000
  ) into v_request_id;
  return v_request_id;
end;
$$;

-- Nothing that speaks to this database over the API may make it call out to
-- the internet. Only the scheduler, which runs as the table owner, can.
revoke execute on function public.drain_tick() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The schedule
-- ---------------------------------------------------------------------------

-- `replay_local.sh` rebuilds this schema from empty on a plain Postgres with
-- neither extension and no Vault, and that rehearsal is the thing standing
-- between us and an unrecoverable production. So the scheduling is skipped
-- where it cannot work, out loud, rather than failing the replay. The function
-- above is created either way — a plpgsql body is not resolved until it runs,
-- so naming `net` and `vault` on a database that has neither is fine.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    execute 'create extension if not exists pg_cron';
    execute 'create extension if not exists pg_net';
    -- Idempotent: a replay, or a second apply, replaces the job rather than
    -- ending up with two of them ticking.
    execute $q$
      select cron.unschedule(jobid) from cron.job where jobname = 'drain-every-five-minutes'
    $q$;
    execute $q$
      select cron.schedule('drain-every-five-minutes', '*/5 * * * *', 'select public.drain_tick()')
    $q$;
  else
    raise notice 'pg_cron/pg_net not available here — the five-minute drain is not scheduled in this database.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The pulse
-- ---------------------------------------------------------------------------

-- One row per drain, so "is the queue being drained?" is a question with an
-- answer. Three months of not knowing is what this is for.
create table if not exists public.drain_runs (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  -- Where the drain came from. `schedule` is the cron calling the endpoint;
  -- `request` is a parent or staff action draining on its way out; `manual` is
  -- somebody pressing Run pending now. Only `schedule` answers the question
  -- above — a busy afternoon of `request` rows says traffic is healthy, not
  -- that the scheduler is.
  source text not null check (source in ('schedule', 'request', 'manual')),
  claimed int not null default 0,
  done int not null default 0,
  skipped int not null default 0,
  failed int not null default 0,
  duration_ms int not null default 0,
  -- The endpoint's sweep counters: sessions created, waitlist promoted, and
  -- the rest. Null for a drain that only ran the queue.
  detail jsonb
);

create index if not exists drain_runs_recent_idx on public.drain_runs (source, ran_at desc);

alter table public.drain_runs enable row level security;

-- Read-only, and only for the people who can already see the queue itself.
-- Writes come from the service role, which RLS does not apply to.
drop policy if exists drain_runs_select on public.drain_runs;
create policy drain_runs_select on public.drain_runs
  for select using ((select public.has_permission('admin')));

-- Kept for a week: long enough to see a gap and prove a fix, short enough that
-- a row per request never becomes a table worth thinking about.
create or replace function public.prune_drain_runs()
returns int
language sql
security invoker
set search_path = public
as $$
  with deleted as (
    delete from public.drain_runs
    where ran_at < now() - interval '7 days'
    returning 1
  )
  select count(*)::int from deleted
$$;

revoke execute on function public.prune_drain_runs() from public, anon, authenticated;
