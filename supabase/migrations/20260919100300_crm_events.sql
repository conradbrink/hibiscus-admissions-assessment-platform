-- Events: open days, the Make-a-Thon, parent meetings.
--
-- An event is a date the school invites families to. A registration is one
-- family (and, where it matters, one child) and what became of the invite:
-- invited, registered, attended, did not attend. Families register from the
-- `event` family link the access tokens already allow for, at
-- `/family/dates`; staff register a family by hand from the event page; a
-- campaign can carry the invitation.

create table if not exists public.crm_events (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 160),
  kind text not null default 'other' check (kind in (
    'open_day', 'robotics_makeathon', 'parent_meeting', 'sports_day',
    'information_session', 'holiday_programme', 'other'
  )),
  -- Null is a group-wide event, visible to everyone with crm.read.
  campus_id uuid references public.campuses(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  description text,
  capacity int check (capacity is null or capacity > 0),
  registration_open boolean not null default true,
  staff_id uuid references public.staff_profiles(id) on delete set null,
  is_cancelled boolean not null default false,
  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);

create index if not exists crm_events_starts_idx on public.crm_events(starts_at);
create index if not exists crm_events_campus_idx on public.crm_events(campus_id) where campus_id is not null;

drop trigger if exists crm_events_set_updated_at on public.crm_events;
create trigger crm_events_set_updated_at
  before update on public.crm_events
  for each row execute function public.set_updated_at();

comment on table public.crm_events is
  'A date the school invites families to. A campus event is scoped to its campus; a group event (campus_id null) is everybody''s.';

create table if not exists public.crm_event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.crm_events(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  status text not null default 'registered' check (status in ('invited', 'registered', 'attended', 'no_show', 'cancelled')),
  source text not null default 'staff' check (source in ('staff', 'parent', 'campaign')),
  campaign_id uuid references public.campaigns(id) on delete set null,
  guests int not null default 0 check (guests >= 0),
  note text,
  registered_at timestamptz,
  attended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per family per child per event. A family registration with no
-- child named is one row too.
create unique index if not exists crm_event_registrations_unique_idx
  on public.crm_event_registrations(event_id, family_id, coalesce(student_id, family_id));
create index if not exists crm_event_registrations_family_idx on public.crm_event_registrations(family_id);
create index if not exists crm_event_registrations_event_status_idx on public.crm_event_registrations(event_id, status);

drop trigger if exists crm_event_registrations_set_updated_at on public.crm_event_registrations;
create trigger crm_event_registrations_set_updated_at
  before update on public.crm_event_registrations
  for each row execute function public.set_updated_at();

-- Stamps and the outbox.
create or replace function public.crm_event_registrations_after_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT' and new.status = 'registered')
     or (tg_op = 'UPDATE' and new.status = 'registered' and old.status is distinct from 'registered') then
    insert into public.crm_trigger_events (type, family_id, student_id, payload)
    values ('event.registered', new.family_id, new.student_id,
            jsonb_build_object('event_id', new.event_id, 'registration_id', new.id, 'source', new.source));
  end if;
  if tg_op = 'UPDATE' and new.status = 'attended' and old.status is distinct from 'attended' then
    insert into public.crm_trigger_events (type, family_id, student_id, payload)
    values ('event.attended', new.family_id, new.student_id,
            jsonb_build_object('event_id', new.event_id, 'registration_id', new.id));
  end if;
  return null;
end;
$$;

revoke all on function public.crm_event_registrations_after_write() from public, anon, authenticated;

drop trigger if exists crm_event_registrations_after_write on public.crm_event_registrations;
create trigger crm_event_registrations_after_write
  after insert or update of status on public.crm_event_registrations
  for each row execute function public.crm_event_registrations_after_write();

create or replace function public.crm_event_registrations_before_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'registered' then new.registered_at := coalesce(new.registered_at, now()); end if;
  if new.status = 'attended' then new.attended_at := coalesce(new.attended_at, now()); end if;
  return new;
end;
$$;

revoke all on function public.crm_event_registrations_before_write() from public, anon, authenticated;

drop trigger if exists crm_event_registrations_before_write on public.crm_event_registrations;
create trigger crm_event_registrations_before_write
  before insert or update on public.crm_event_registrations
  for each row execute function public.crm_event_registrations_before_write();

-- A campaign may be the invitation to an event.
alter table public.campaigns
  add column if not exists event_id uuid references public.crm_events(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

alter table public.crm_events enable row level security;
alter table public.crm_event_registrations enable row level security;

drop policy if exists crm_events_select on public.crm_events;
create policy crm_events_select on public.crm_events
  for select using (
    (select public.has_permission('crm.read'))
    and (campus_id is null or (select public.can_access_campus(campus_id)))
  );

drop policy if exists crm_events_insert on public.crm_events;
create policy crm_events_insert on public.crm_events
  for insert with check (
    (select public.has_permission('crm.write'))
    and (campus_id is null or (select public.can_access_campus(campus_id)))
    and created_by = (select auth.uid())
  );

drop policy if exists crm_events_update on public.crm_events;
create policy crm_events_update on public.crm_events
  for update using (
    (select public.has_permission('crm.write'))
    and (campus_id is null or (select public.can_access_campus(campus_id)))
  );

drop policy if exists crm_event_registrations_select on public.crm_event_registrations;
create policy crm_event_registrations_select on public.crm_event_registrations
  for select using (
    exists (select 1 from public.crm_events e where e.id = crm_event_registrations.event_id)
    and (select public.can_access_family(family_id))
  );

drop policy if exists crm_event_registrations_insert on public.crm_event_registrations;
create policy crm_event_registrations_insert on public.crm_event_registrations
  for insert with check (
    (select public.has_permission('crm.write'))
    and exists (select 1 from public.crm_events e where e.id = crm_event_registrations.event_id)
    and (select public.can_access_family(family_id))
    and source = 'staff'
  );

drop policy if exists crm_event_registrations_update on public.crm_event_registrations;
create policy crm_event_registrations_update on public.crm_event_registrations
  for update using (
    (select public.has_permission('crm.write'))
    and exists (select 1 from public.crm_events e where e.id = crm_event_registrations.event_id)
    and (select public.can_access_family(family_id))
  );

-- ---------------------------------------------------------------------------
-- A family registering itself, atomically
-- ---------------------------------------------------------------------------

-- The capacity check and the write in one transaction, with the event row
-- locked, so two families tapping "we are coming" for the last seat cannot
-- both read one seat left. Replaces the row for the same child (or the
-- family's own row) rather than adding a second, and counts the seats that
-- row held so a family changing its guests is not refused its own place.
-- Service role only: the parent holds no database session, and the page
-- has already checked the event is one the family may see and the child is
-- theirs.
create or replace function public.crm_register_family_for_event(
  p_event_id uuid,
  p_family_id uuid,
  p_student_id uuid,
  p_contact_id uuid,
  p_guests int,
  p_note text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_capacity int;
  v_open boolean;
  v_cancelled boolean;
  v_existing_id uuid;
  v_existing_status text;
  v_existing_guests int;
  v_taken int;
  v_guests int := greatest(0, least(10, coalesce(p_guests, 0)));
begin
  select capacity, registration_open, is_cancelled
    into v_capacity, v_open, v_cancelled
    from public.crm_events
   where id = p_event_id
   for update;
  if not found or v_cancelled then
    raise exception 'event_not_found';
  end if;
  if not v_open then
    raise exception 'registration_closed';
  end if;

  select id, status, guests into v_existing_id, v_existing_status, v_existing_guests
    from public.crm_event_registrations
   where event_id = p_event_id
     and family_id = p_family_id
     and coalesce(student_id, family_id) = coalesce(p_student_id, p_family_id);

  if v_capacity is not null then
    select coalesce(sum(1 + guests), 0) into v_taken
      from public.crm_event_registrations
     where event_id = p_event_id
       and status in ('registered', 'attended')
       and (v_existing_id is null or id <> v_existing_id);
    if v_taken + 1 + v_guests > v_capacity then
      raise exception 'event_full';
    end if;
  end if;

  if v_existing_id is not null then
    update public.crm_event_registrations
       set status = 'registered', guests = v_guests, note = p_note
     where id = v_existing_id;
    return 'updated';
  end if;
  insert into public.crm_event_registrations (event_id, family_id, student_id, contact_id, status, source, guests, note)
  values (p_event_id, p_family_id, p_student_id, p_contact_id, 'registered', 'parent', v_guests, p_note);
  return 'inserted';
end;
$$;

revoke execute on function public.crm_register_family_for_event(uuid, uuid, uuid, uuid, int, text) from public, anon, authenticated;
