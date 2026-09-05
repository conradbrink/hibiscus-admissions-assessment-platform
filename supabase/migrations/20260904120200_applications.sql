-- Contacts, applications, the timeline, tasks and notes.
--
-- An application is one child applying for one intake. It is the aggregate
-- root: everything else in the system hangs off `applications.id`, and the
-- pipeline the staff console shows is `applications.status`.
--
-- ⚠️ `applications.status` has one writer: the workflow engine, through
-- `commit_transition()` (20260904120800_workflow_engine.sql). Staff clients
-- are refused UPDATE on that column by grant, below. Everything else raises
-- an event and lets the engine project the status, which is how the pipeline
-- view and reality stay in agreement.

-- ---------------------------------------------------------------------------
-- Contacts
-- ---------------------------------------------------------------------------

-- A parent or guardian. Keyed on the normalised email so that a second child
-- from the same family joins the same contact rather than creating a
-- duplicate — the current form's "Click to Apply for Additional student"
-- restarts everything from scratch.
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text not null,
  email_normalised text not null unique,
  mobile text,
  -- E.164 where it could be parsed; the raw value is kept alongside.
  mobile_normalised text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists contacts_set_updated_at on public.contacts;
create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute function public.set_updated_at();

create index if not exists contacts_mobile_idx on public.contacts(mobile_normalised)
  where mobile_normalised is not null;

-- ---------------------------------------------------------------------------
-- Reference numbers
-- ---------------------------------------------------------------------------

-- HBS-2026-00482. Per-year sequential with no gaps visible to a parent, which
-- a global sequence cannot give (a rolled-back insert burns a sequence value).
-- The counter row is locked for the duration of the insert transaction, so
-- two parents submitting at once get consecutive numbers rather than the
-- same one.
create table if not exists public.reference_counters (
  year int primary key,
  next_value int not null default 1
);

create or replace function public.next_application_reference()
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_year int := extract(year from now() at time zone 'Africa/Gaborone')::int;
  v_next int;
begin
  insert into public.reference_counters (year) values (v_year)
  on conflict (year) do nothing;

  update public.reference_counters
     set next_value = next_value + 1
   where year = v_year
   returning next_value - 1 into v_next;

  return format('HBS-%s-%s', v_year, lpad(v_next::text, 5, '0'));
end;
$$;

revoke execute on function public.next_application_reference() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Applications
-- ---------------------------------------------------------------------------

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  contact_id uuid not null references public.contacts(id) on delete restrict,

  -- What the funnel collects: the child's name and date of birth. Everything
  -- else about the child is registration data and lives in Phase 3 tables.
  child_first_name text not null,
  child_last_name text not null,
  child_date_of_birth date not null,
  child_preferred_name text,

  campus_id uuid not null references public.campuses(id) on delete restrict,
  grade_id uuid not null references public.grades(id) on delete restrict,
  -- What the system suggested from the date of birth, kept so overrides can
  -- be measured. If parents routinely pick something else the rule is wrong.
  recommended_grade_id uuid references public.grades(id) on delete set null,
  intake_id uuid not null references public.intakes(id) on delete restrict,
  -- Copied from the grade at creation and recomputed if the grade changes.
  -- The workflow engine reads this, never the grade, so a later change to
  -- the grade's rule does not silently re-route an applicant mid-journey.
  requires_assessment boolean not null,

  current_school text,
  current_grade text,

  -- The pipeline. The full set for every phase is listed now so that a later
  -- phase adds code, not a constraint change. Reachability is the engine's
  -- business; the database only checks membership.
  status text not null default 'new_enquiry' check (status in (
    'new_enquiry',
    'visit_booked',
    'callback_requested',
    'assessment_booked',
    'no_show',
    'assessment_in_progress',
    'assessment_completed',
    'awaiting_decision',
    'staff_review',
    'approved',
    'waitlisted',
    'declined',
    'offer_draft',
    'offer_pending_approval',
    'offer_sent',
    'offer_expired',
    'offer_declined',
    'offer_accepted',
    'payment_required',
    'payment_processing',
    'paid',
    'registration_incomplete',
    'registration_complete',
    'enrolled',
    'withdrawn'
  )),
  status_changed_at timestamptz not null default now(),

  -- Which of the three doors the parent came through.
  entry_route text not null check (entry_route in ('assessment', 'visit', 'callback')),
  source text not null default 'website' check (source in (
    'website', 'staff', 'referral', 'walk_in', 'phone', 'other'
  )),

  owner_staff_id uuid references public.staff_profiles(id) on delete set null,

  -- "What happens next?" — for the parent, and for the staff pipeline. A
  -- machine key; the wording lives in code and templates.
  next_action text,
  next_action_due_at timestamptz,

  withdrawn_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.applications is
  'One child applying for one intake. The aggregate root of the whole system.';

drop trigger if exists applications_set_updated_at on public.applications;
create trigger applications_set_updated_at
  before update on public.applications
  for each row execute function public.set_updated_at();

create index if not exists applications_contact_idx on public.applications(contact_id);
create index if not exists applications_status_idx on public.applications(status, campus_id);
create index if not exists applications_owner_idx on public.applications(owner_staff_id)
  where owner_staff_id is not null;
create index if not exists applications_next_action_idx on public.applications(next_action_due_at)
  where next_action_due_at is not null;
create index if not exists applications_created_idx on public.applications(created_at desc);

-- Keeps `requires_assessment` honest when a member of staff changes the grade.
create or replace function public.applications_sync_requires_assessment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' or new.grade_id is distinct from old.grade_id then
    select requires_assessment into new.requires_assessment
      from public.grades where id = new.grade_id;
  end if;
  return new;
end;
$$;

revoke all on function public.applications_sync_requires_assessment() from public, anon, authenticated;

drop trigger if exists applications_sync_requires_assessment on public.applications;
create trigger applications_sync_requires_assessment
  before insert or update of grade_id on public.applications
  for each row execute function public.applications_sync_requires_assessment();

-- ---------------------------------------------------------------------------
-- Guardians
-- ---------------------------------------------------------------------------

create table if not exists public.application_guardians (
  application_id uuid not null references public.applications(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  relationship text not null default 'parent' check (relationship in (
    'mother', 'father', 'parent', 'guardian', 'grandparent', 'other'
  )),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (application_id, contact_id)
);

-- ---------------------------------------------------------------------------
-- Timeline
-- ---------------------------------------------------------------------------

-- Append-only. Both the timeline a member of staff reads on the applicant's
-- profile and the event bus the workflow engine reacts to. bigint identity
-- for the same reason as audit_log: strict ordering.
create table if not exists public.application_events (
  id bigint generated always as identity primary key,
  application_id uuid not null references public.applications(id) on delete cascade,
  type text not null,
  actor_type text not null check (actor_type in ('staff', 'parent', 'system')),
  actor_id uuid,
  -- One readable line: "Assessment booked for Sat 12 Sep, 09:00".
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists application_events_application_idx
  on public.application_events(application_id, id desc);
create index if not exists application_events_type_idx
  on public.application_events(type, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.applications(id) on delete cascade,
  -- Denormalised so the task list can be campus-scoped without a join.
  campus_id uuid references public.campuses(id) on delete set null,
  type text not null,
  title text not null,
  details text,
  assignee_staff_id uuid references public.staff_profiles(id) on delete set null,
  due_at timestamptz,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  created_by_type text not null default 'system' check (created_by_type in ('staff', 'system')),
  created_by uuid references public.staff_profiles(id) on delete set null,
  resolved_at timestamptz,
  resolved_by uuid references public.staff_profiles(id) on delete set null,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

create index if not exists tasks_open_idx on public.tasks(due_at)
  where status = 'open';
create index if not exists tasks_assignee_idx on public.tasks(assignee_staff_id)
  where status = 'open';
create index if not exists tasks_application_idx on public.tasks(application_id);

-- ---------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  author_staff_id uuid not null references public.staff_profiles(id) on delete cascade,
  body text not null check (length(body) between 1 and 4000),
  is_pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();

create index if not exists notes_application_idx on public.notes(application_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Audit of direct staff edits
-- ---------------------------------------------------------------------------

-- The engine writes its own audit rows under the service role. This trigger
-- covers the other path: a member of staff editing a child's name or moving
-- an applicant to another campus through the console. It fires only when
-- there is a signed-in user, so engine writes are not double-logged.
create or replace function public.audit_applications_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_label text;
begin
  if v_actor is null then
    return new;
  end if;
  select email into v_label from public.staff_profiles where id = v_actor;
  insert into public.audit_log (
    actor_type, actor_id, actor_label, action, entity_type, entity_id,
    application_id, before, after
  ) values (
    'staff', v_actor, v_label, 'application.updated', 'application', new.id,
    new.id, to_jsonb(old), to_jsonb(new)
  );
  return new;
end;
$$;

revoke all on function public.audit_applications_update() from public, anon, authenticated;

drop trigger if exists applications_audit_update on public.applications;
create trigger applications_audit_update
  after update on public.applications
  for each row execute function public.audit_applications_update();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.contacts enable row level security;
alter table public.reference_counters enable row level security;
alter table public.applications enable row level security;
alter table public.application_guardians enable row level security;
alter table public.application_events enable row level security;
alter table public.tasks enable row level security;
alter table public.notes enable row level security;

-- reference_counters: RLS on, zero policies. Only the function above touches
-- it, and only the service role may call that.

-- Contacts are visible with applications.read, scoped by the campuses of the
-- applications they are attached to. A contact with no application is not
-- reachable through the console at all.
drop policy if exists contacts_select on public.contacts;
create policy contacts_select on public.contacts
  for select using (
    (select public.has_permission('applications.read'))
    and exists (
      select 1 from public.applications a
      where a.contact_id = contacts.id
        and (select public.can_access_campus(a.campus_id))
    )
  );

drop policy if exists contacts_update on public.contacts;
create policy contacts_update on public.contacts
  for update using (
    (select public.has_permission('applications.write'))
    and exists (
      select 1 from public.applications a
      where a.contact_id = contacts.id
        and (select public.can_access_campus(a.campus_id))
    )
  );

-- Contacts are created by the service role when an enquiry arrives, and by
-- staff for a walk-in.
drop policy if exists contacts_insert on public.contacts;
create policy contacts_insert on public.contacts
  for insert with check ((select public.has_permission('applications.write')));

drop policy if exists applications_select on public.applications;
create policy applications_select on public.applications
  for select using (
    (select public.has_permission('applications.read'))
    and (select public.can_access_campus(campus_id))
  );

drop policy if exists applications_insert on public.applications;
create policy applications_insert on public.applications
  for insert with check (
    (select public.has_permission('applications.write'))
    and (select public.can_access_campus(campus_id))
  );

drop policy if exists applications_update on public.applications;
create policy applications_update on public.applications
  for update using (
    (select public.has_permission('applications.write'))
    and (select public.can_access_campus(campus_id))
  );

-- No delete policy. Withdrawn is a status; an enquiry that existed is a fact
-- the analytics depend on.

-- A policy sees a row, not a diff, so it cannot say "these columns are
-- read-only". A column grant can. Staff may edit what a parent told us and
-- who owns the case; the pipeline columns belong to the engine.
revoke update on public.applications from authenticated;
grant update (
  child_first_name,
  child_last_name,
  child_preferred_name,
  child_date_of_birth,
  current_school,
  current_grade,
  campus_id,
  grade_id,
  intake_id,
  owner_staff_id,
  source
) on public.applications to authenticated;

drop policy if exists application_guardians_select on public.application_guardians;
create policy application_guardians_select on public.application_guardians
  for select using (
    exists (
      select 1 from public.applications a
      where a.id = application_guardians.application_id
        and (select public.has_permission('applications.read'))
        and (select public.can_access_campus(a.campus_id))
    )
  );

drop policy if exists application_events_select on public.application_events;
create policy application_events_select on public.application_events
  for select using (
    exists (
      select 1 from public.applications a
      where a.id = application_events.application_id
        and (select public.has_permission('applications.read'))
        and (select public.can_access_campus(a.campus_id))
    )
  );
-- Events are written only by the engine. No insert, update or delete for
-- authenticated.

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select using (
    (select public.has_permission('applications.read'))
    and (campus_id is null or (select public.can_access_campus(campus_id)))
  );

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert with check (
    (select public.has_permission('applications.write'))
    and (campus_id is null or (select public.can_access_campus(campus_id)))
    and created_by_type = 'staff'
    and created_by = (select auth.uid())
  );

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update using (
    (select public.has_permission('applications.write'))
    and (campus_id is null or (select public.can_access_campus(campus_id)))
  );

drop policy if exists notes_select on public.notes;
create policy notes_select on public.notes
  for select using (
    exists (
      select 1 from public.applications a
      where a.id = notes.application_id
        and (select public.has_permission('applications.read'))
        and (select public.can_access_campus(a.campus_id))
    )
  );

-- Pinned to the author: a note cannot be written as somebody else.
drop policy if exists notes_insert on public.notes;
create policy notes_insert on public.notes
  for insert with check (
    author_staff_id = (select auth.uid())
    and exists (
      select 1 from public.applications a
      where a.id = notes.application_id
        and (select public.has_permission('applications.write'))
        and (select public.can_access_campus(a.campus_id))
    )
  );

drop policy if exists notes_update on public.notes;
create policy notes_update on public.notes
  for update using (author_staff_id = (select auth.uid()));

drop policy if exists notes_delete on public.notes;
create policy notes_delete on public.notes
  for delete using (author_staff_id = (select auth.uid()));
