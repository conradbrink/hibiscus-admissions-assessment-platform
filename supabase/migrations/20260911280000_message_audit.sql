-- An audit trail for WhatsApp, and proof a message actually arrived.
--
-- `messages` carries one row per message and overwrites its status in place:
-- queued becomes sent becomes delivered becomes read. That is the right shape
-- for "what is the state of this message", and the wrong shape for "what
-- happened to it". Every earlier state is destroyed by the next update, an
-- error is overwritten by the webhook that follows it, and a delivery receipt
-- that arrives out of order is dropped with no record it was ever seen.
--
-- So the history moves here, append-only, one row per assertion anyone makes
-- about a message. `messages.status` stays as it is — the current state, read
-- by every existing query — and this table says how it got there.
--
-- Two things make it an audit trail rather than a log:
--
--   * Nothing is ever updated or deleted. There is a select policy and no
--     other policy, so only the service role writes, exactly as `audit_log`
--     does. A trail a user can edit is not a trail.
--   * A dropped assertion is recorded too, with `applied = false`. A late
--     `delivered` after a `read` changes nothing about the message, but the
--     fact that the provider said it, and when, is the sort of thing you only
--     want when you are already trying to work out what went wrong.

-- ---------------------------------------------------------------------------
-- Where a message came from
-- ---------------------------------------------------------------------------

-- `sendCompanionMessage` has always taken a `trigger` argument and never
-- stored it, so a message sent by hand by a named member of staff has looked
-- exactly like one the drain sent beside an email.
alter table public.messages
  add column if not exists trigger_source text
    check (trigger_source is null or trigger_source in ('companion', 'manual', 'family', 'inbound')),
  add column if not exists sent_by uuid references public.staff_profiles(id) on delete set null;

comment on column public.messages.trigger_source is
  'What caused this message: the drain beside an email (companion), a member of staff pressing Send (manual), a family moment (family), or the parent (inbound).';
comment on column public.messages.sent_by is
  'The member of staff who sent it by hand. Null for everything the system sent on its own.';

-- ---------------------------------------------------------------------------
-- The trail
-- ---------------------------------------------------------------------------

-- bigint identity rather than uuid, for the same reason `audit_log` uses one:
-- this is append-only and callers order by it, and two receipts landing in the
-- same millisecond still need a definite order.
create table if not exists public.message_events (
  id bigint generated always as identity primary key,
  message_id uuid not null references public.messages(id) on delete cascade,
  -- What this event asserts the message's state to be.
  status text not null check (status in (
    'queued', 'sent', 'delivered', 'read', 'failed', 'skipped', 'received'
  )),
  -- Who is asserting it. `webhook` is the provider telling us what happened to
  -- a message after it left; `send` is our own send path; `staff` is a person.
  source text not null check (source in ('send', 'webhook', 'staff', 'system', 'backfill')),
  actor_id uuid references public.staff_profiles(id) on delete set null,
  -- A readable identity for the trail, resolved once at write time so the row
  -- still reads correctly after a staff member leaves.
  actor_label text,
  -- The provider's own status word, unmapped, so a status we do not model is
  -- still legible here rather than silently becoming the nearest one we do.
  provider_status text,
  -- The provider's own words: why it failed, or why the moment was skipped.
  detail text,
  -- Did this assertion move `messages.status`? False for one that arrived out
  -- of order, or that said nothing new.
  applied boolean not null default true,
  -- When it happened, per whoever is asserting it.
  occurred_at timestamptz not null default now(),
  -- When we learned of it. For a webhook these differ, and the gap is worth
  -- seeing: a delivery receipt half an hour late is a different problem from
  -- one that never came.
  recorded_at timestamptz not null default now()
);

create index if not exists message_events_message_idx
  on public.message_events(message_id, id);

comment on table public.message_events is
  'Append-only. One row per assertion about a WhatsApp message, including assertions that were recorded and not applied. Written under the service role only; no role may update or delete a row.';

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.message_events enable row level security;

-- Visible with the message it describes, which is in turn visible with its
-- application or its family. Delegating to `messages` rather than repeating
-- the campus check keeps the two from drifting apart.
drop policy if exists message_events_select on public.message_events;
create policy message_events_select on public.message_events
  for select using (
    exists (
      select 1 from public.messages m
      where m.id = message_events.message_id
    )
  );

-- ---------------------------------------------------------------------------
-- Backfill: the history we can still recover
-- ---------------------------------------------------------------------------

-- Every message already in the table has timestamps for the states it passed
-- through. That is not the whole story — an overwritten error is gone for
-- good — but it means the trail does not start empty for messages the school
-- has already sent, and the sends we have been debugging all week keep their
-- delivery receipts.
--
-- `source = 'backfill'` marks these as reconstructed rather than observed:
-- `occurred_at` is real, `recorded_at` is not.
insert into public.message_events (message_id, status, source, detail, occurred_at, recorded_at, applied)
select m.id, e.status, 'backfill', e.detail, e.at, now(), true
from public.messages m
cross join lateral (
  values
    ('queued',    m.created_at,   null::text),
    ('sent',      m.sent_at,      null),
    ('delivered', m.delivered_at, null),
    ('read',      m.read_at,      null),
    ('received',  m.received_at,  null),
    -- A failure or a skip has no timestamp of its own; the row's last update
    -- is the closest honest answer, and the reason survived in `error`.
    (case when m.status in ('failed', 'skipped') then m.status end, m.updated_at, m.error)
) as e(status, at, detail)
where e.status is not null
  and e.at is not null
  and not exists (select 1 from public.message_events x where x.message_id = m.id)
order by m.created_at, e.at;

-- The trigger source is recoverable for inbound messages and family messages;
-- for everything else it is genuinely unknown and stays null rather than
-- being guessed at.
update public.messages set trigger_source = 'inbound' where direction = 'in' and trigger_source is null;
update public.messages set trigger_source = 'family' where family_id is not null and direction = 'out' and trigger_source is null;
