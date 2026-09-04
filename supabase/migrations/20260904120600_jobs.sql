-- The job outbox.
--
-- Vercel serverless has no long-running worker, so side effects that must
-- happen later — a reminder in 48 hours, an offer expiring in a fortnight —
-- are rows here. The workflow engine inserts them in the same transaction as
-- the state change they belong to, so a state change and its consequences
-- cannot disagree. `after()` drains immediately for the common case, and a
-- cron every five minutes is the durability guarantee.
--
-- Every job carries an idempotency key and a precondition. The key means a
-- crash mid-drain cannot send the same email twice; the precondition means a
-- reminder for a booking that was since cancelled is skipped, not sent.

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  application_id uuid references public.applications(id) on delete cascade,
  idempotency_key text not null unique,
  run_after timestamptz not null default now(),
  -- A serialised assertion about the state this job assumes, checked by the
  -- drain immediately before running: e.g. {"application_status":
  -- ["assessment_booked"], "booking_id": "…", "booking_status": ["booked"]}.
  precondition jsonb,
  status text not null default 'pending' check (status in (
    'pending', 'running', 'done', 'failed', 'skipped'
  )),
  attempts int not null default 0,
  max_attempts int not null default 5,
  last_error text,
  locked_at timestamptz,
  locked_by text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists jobs_set_updated_at on public.jobs;
create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

create index if not exists jobs_due_idx on public.jobs(run_after)
  where status = 'pending';
create index if not exists jobs_application_idx on public.jobs(application_id)
  where application_id is not null;

-- Claim a batch for one worker. `for update skip locked` means two drains
-- running at once (the cron and an `after()` call) divide the work rather
-- than both taking it. A job left 'running' for ten minutes is assumed dead
-- and reclaimed.
create or replace function public.claim_jobs(p_worker text, p_limit int default 25)
returns setof public.jobs
language sql
security invoker
set search_path = public
as $$
  update public.jobs
     set status = 'running',
         locked_at = now(),
         locked_by = p_worker,
         attempts = attempts + 1
   where id in (
     select id
       from public.jobs
      where (
              status = 'pending'
              or (status = 'running' and locked_at < now() - interval '10 minutes')
            )
        and run_after <= now()
      order by run_after
      for update skip locked
      limit p_limit
   )
  returning *
$$;

revoke execute on function public.claim_jobs(text, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.jobs enable row level security;

-- Visible to administrators for the queue page. Written only by the engine
-- and the drain, under the service role.
drop policy if exists jobs_select on public.jobs;
create policy jobs_select on public.jobs
  for select using ((select public.has_permission('admin')));
