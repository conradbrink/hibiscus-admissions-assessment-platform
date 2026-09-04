-- Assessment and visit sessions, bookings, and callback requests.
--
-- A session is a staff-published slot — "Saturday 12 September, 09:00, Block
-- 7 computer lab, six places". Assessments and school visits share the shape
-- and differ by `kind`, so they share a table rather than two copies of it.
-- The parent picks a session; the booking is made by `book_session()`, which
-- holds a lock on the session row while it counts, so the seventh parent for
-- a six-place slot is refused rather than double-booked.

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('assessment', 'visit')),
  campus_id uuid not null references public.campuses(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity int not null default 6 check (capacity > 0),
  -- Restrict a session to a band of grades by sort order. Null on both
  -- means any grade the campus offers. A Reception sitting and a Form 3
  -- sitting are different rooms with different papers.
  min_grade_sort int,
  max_grade_sort int,
  assessor_staff_id uuid references public.staff_profiles(id) on delete set null,
  location text,
  -- Unpublished sessions are staff drafts and never offered to a parent.
  is_published boolean not null default false,
  notes text,
  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (min_grade_sort is null or max_grade_sort is null or max_grade_sort >= min_grade_sort)
);

drop trigger if exists sessions_set_updated_at on public.sessions;
create trigger sessions_set_updated_at
  before update on public.sessions
  for each row execute function public.set_updated_at();

create index if not exists sessions_upcoming_idx
  on public.sessions(kind, campus_id, starts_at)
  where is_published;

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete restrict,
  kind text not null check (kind in ('assessment', 'visit')),
  status text not null default 'booked' check (status in (
    'booked', 'checked_in', 'in_progress', 'completed', 'no_show', 'cancelled', 'rescheduled'
  )),
  booked_at timestamptz not null default now(),
  checked_in_at timestamptz,
  checked_in_by uuid references public.staff_profiles(id) on delete set null,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  -- When a booking is moved, the old row stays as 'rescheduled' pointing at
  -- its replacement. The timeline can then show "moved from Sat 12 to Sat 19".
  rescheduled_to_id uuid references public.bookings(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists bookings_set_updated_at on public.bookings;
create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- One live booking per application per kind. The partial index is the rule,
-- not a hint: a second live assessment booking is refused by the database.
create unique index if not exists bookings_one_live_per_application_idx
  on public.bookings(application_id, kind)
  where status in ('booked', 'checked_in', 'in_progress');

create index if not exists bookings_session_idx on public.bookings(session_id, status);

-- Counts only the statuses that occupy a place. A cancelled or rescheduled
-- booking frees its seat; a completed one does not free it for someone else
-- on the same day.
create or replace function public.session_places_taken(p_session_id uuid)
returns int
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)::int
  from public.bookings
  where session_id = p_session_id
    and status in ('booked', 'checked_in', 'in_progress', 'completed')
$$;

-- Book a place, atomically.
--
-- Raises rather than returning a code, so a caller that forgets to check
-- cannot proceed on a failed booking. Message text is stable and matched by
-- the application layer: 'session_full', 'session_unavailable',
-- 'session_in_past', 'already_booked', 'grade_not_in_range'.
create or replace function public.book_session(
  p_application_id uuid,
  p_session_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  s public.sessions%rowtype;
  v_grade_sort int;
  v_booking_id uuid;
begin
  select * into s from public.sessions where id = p_session_id for update;
  if not found or not s.is_published then
    raise exception 'session_unavailable';
  end if;
  if s.starts_at <= now() then
    raise exception 'session_in_past';
  end if;

  select g.sort_order into v_grade_sort
  from public.applications a
  join public.grades g on g.id = a.grade_id
  where a.id = p_application_id;

  if v_grade_sort is null then
    raise exception 'application_not_found';
  end if;

  if (s.min_grade_sort is not null and v_grade_sort < s.min_grade_sort)
     or (s.max_grade_sort is not null and v_grade_sort > s.max_grade_sort) then
    raise exception 'grade_not_in_range';
  end if;

  if public.session_places_taken(p_session_id) >= s.capacity then
    raise exception 'session_full';
  end if;

  insert into public.bookings (application_id, session_id, kind)
  values (p_application_id, p_session_id, s.kind)
  returning id into v_booking_id;

  return v_booking_id;
exception
  when unique_violation then
    raise exception 'already_booked';
end;
$$;

revoke execute on function public.book_session(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.session_places_taken(uuid) from public, anon;
grant execute on function public.session_places_taken(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Callback requests
-- ---------------------------------------------------------------------------

-- The third door. The task that drives the phone call lives in `tasks`; this
-- row keeps what the parent said about when to call.
create table if not exists public.callback_requests (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  preferred_time text,
  message text check (message is null or length(message) <= 1000),
  created_at timestamptz not null default now()
);

create index if not exists callback_requests_application_idx
  on public.callback_requests(application_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.sessions enable row level security;
alter table public.bookings enable row level security;
alter table public.callback_requests enable row level security;

drop policy if exists sessions_select on public.sessions;
create policy sessions_select on public.sessions
  for select using (
    (select public.current_staff_id()) is not null
    and (select public.can_access_campus(campus_id))
  );

drop policy if exists sessions_insert on public.sessions;
create policy sessions_insert on public.sessions
  for insert with check (
    (select public.has_permission('applications.write'))
    and (select public.can_access_campus(campus_id))
    and created_by = (select auth.uid())
  );

drop policy if exists sessions_update on public.sessions;
create policy sessions_update on public.sessions
  for update using (
    (select public.has_permission('applications.write'))
    and (select public.can_access_campus(campus_id))
  );

-- Delete only while nobody is booked on it. Otherwise unpublish.
drop policy if exists sessions_delete on public.sessions;
create policy sessions_delete on public.sessions
  for delete using (
    (select public.has_permission('applications.write'))
    and (select public.can_access_campus(campus_id))
    and not exists (select 1 from public.bookings b where b.session_id = sessions.id)
  );

drop policy if exists bookings_select on public.bookings;
create policy bookings_select on public.bookings
  for select using (
    exists (
      select 1 from public.applications a
      where a.id = bookings.application_id
        and (select public.has_permission('applications.read'))
        and (select public.can_access_campus(a.campus_id))
    )
  );

-- Bookings are created by `book_session()` and their status is moved by the
-- workflow engine, both under the service role. Staff check-in goes through
-- the engine too so that the application status follows. No write policies
-- for authenticated.

drop policy if exists callback_requests_select on public.callback_requests;
create policy callback_requests_select on public.callback_requests
  for select using (
    exists (
      select 1 from public.applications a
      where a.id = callback_requests.application_id
        and (select public.has_permission('applications.read'))
        and (select public.can_access_campus(a.campus_id))
    )
  );
