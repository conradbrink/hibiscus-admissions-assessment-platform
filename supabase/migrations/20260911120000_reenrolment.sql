-- Asking, every term, whether the child is coming back.
--
-- This is the school's own answer to "what is the CRM actually for". Not
-- arrears, not statements: knowing before a term starts which children the
-- school still has, and taking the chance — while the family is answering
-- anyway — to check that everything we hold about them is still true.
--
-- Two rows. A `reenrolment_cycle` is one asking: a term, a scope, a window,
-- and whether it also asks the family to confirm their details. A
-- `reenrolment_response` is one child inside it. Opening a cycle writes one
-- response per enrolled child in scope, so from that moment the board is a
-- call list that only shrinks.
--
-- The answer is deliberately three-valued. "Not sure yet" is the most useful
-- thing a parent can say in September, and forcing yes or no would turn it
-- into silence — which reads the same as never having been asked.

create table if not exists public.reenrolment_cycles (
  id uuid primary key default gen_random_uuid(),
  -- The term the school is asking about: the one they would come back for.
  intake_id uuid not null references public.intakes(id) on delete restrict,
  -- Null asks every campus at once; a campus id asks only that one, which is
  -- how a single campus runs its own round without disturbing the others.
  campus_id uuid references public.campuses(id) on delete cascade,
  name text not null,
  opens_on date not null,
  closes_on date not null,
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  -- Days before `closes_on` at which an unanswered family is chased.
  reminder_offsets_days int[] not null default '{7,2}',
  -- The other half of the point: while they are answering, ask them to check
  -- what we hold is still right.
  ask_details_refresh boolean not null default true,
  opened_by uuid references public.staff_profiles(id) on delete set null,
  opened_at timestamptz,
  closed_by uuid references public.staff_profiles(id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (closes_on >= opens_on)
);

create index if not exists reenrolment_cycles_intake_idx on public.reenrolment_cycles(intake_id);
create index if not exists reenrolment_cycles_open_idx on public.reenrolment_cycles(status) where status = 'open';

drop trigger if exists reenrolment_cycles_set_updated_at on public.reenrolment_cycles;
create trigger reenrolment_cycles_set_updated_at
  before update on public.reenrolment_cycles
  for each row execute function public.set_updated_at();

comment on table public.reenrolment_cycles is
  'One asking of "is the child coming back", for one term and one scope of campuses.';

create table if not exists public.reenrolment_responses (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.reenrolment_cycles(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  -- The enrolment this answer is about — the one they are in now, not the one
  -- it might create.
  enrolment_id uuid references public.enrolments(id) on delete set null,
  -- Denormalised for the read policy, like `tasks.campus_id`: a board filtered
  -- by campus must not have to reach through two tables to be scoped.
  campus_id uuid not null references public.campuses(id) on delete restrict,

  -- Three values on purpose. "Not sure yet" in September is real information;
  -- forcing a yes or a no turns it into silence, and silence reads the same
  -- as never having been asked.
  intent text check (intent in ('returning', 'not_returning', 'undecided')),
  reason text,
  leaving_destination text,
  -- Where they would go back to, when they are returning. Suggested by the
  -- rules and confirmable by a person; null until someone says.
  next_grade_id uuid references public.grades(id) on delete set null,
  next_campus_id uuid references public.campuses(id) on delete set null,

  answered_at timestamptz,
  answered_by text check (answered_by in ('parent', 'staff')),
  answered_by_staff_id uuid references public.staff_profiles(id) on delete set null,
  -- The details half. `details_changed` names the fields the family actually
  -- corrected, so the school can see what was wrong rather than only that
  -- somebody pressed a button.
  details_confirmed_at timestamptz,
  details_changed jsonb not null default '[]'::jsonb,

  asked_at timestamptz,
  reminders_sent int not null default 0,
  last_reminder_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, student_id)
);

create index if not exists reenrolment_responses_cycle_idx on public.reenrolment_responses(cycle_id);
create index if not exists reenrolment_responses_student_idx on public.reenrolment_responses(student_id);
create index if not exists reenrolment_responses_open_idx
  on public.reenrolment_responses(cycle_id, campus_id) where answered_at is null;

drop trigger if exists reenrolment_responses_set_updated_at on public.reenrolment_responses;
create trigger reenrolment_responses_set_updated_at
  before update on public.reenrolment_responses
  for each row execute function public.set_updated_at();

comment on column public.reenrolment_responses.intent is
  'returning, not_returning or undecided. Null means not yet answered — which is what the board chases.';

-- ---------------------------------------------------------------------------
-- Opening a cycle
-- ---------------------------------------------------------------------------

-- One row per enrolled child in scope, in one statement, so a board is never
-- half-built. Idempotent: opening an already-open cycle adds the children who
-- have arrived since and leaves every existing answer alone.
create or replace function public.open_reenrolment_cycle(p_cycle_id uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.reenrolment_cycles%rowtype;
  v_added int;
begin
  select * into c from public.reenrolment_cycles where id = p_cycle_id for update;
  if not found then
    raise exception 'cycle_not_found';
  end if;
  if c.status = 'closed' then
    raise exception 'cycle_closed';
  end if;

  insert into public.reenrolment_responses (cycle_id, student_id, enrolment_id, campus_id)
  select c.id, s.id, e.id, s.current_campus_id
    from public.students s
    left join lateral (
      select e2.id
        from public.enrolments e2
       where e2.student_id = s.id and e2.status in ('pending', 'active')
       order by e2.starts_on desc nulls last
       limit 1
    ) e on true
   where s.status in ('onboarding', 'active')
     and (c.campus_id is null or s.current_campus_id = c.campus_id)
  on conflict (cycle_id, student_id) do nothing;

  get diagnostics v_added = row_count;

  update public.reenrolment_cycles
     set status = 'open', opened_at = coalesce(opened_at, now())
   where id = c.id;

  return v_added;
end;
$$;

revoke execute on function public.open_reenrolment_cycle(uuid) from public, anon, authenticated;

comment on function public.open_reenrolment_cycle(uuid) is
  'Writes one response per enrolled child in scope and opens the cycle. Idempotent: re-opening adds newcomers and touches no existing answer.';

-- ---------------------------------------------------------------------------
-- Who may ask
-- ---------------------------------------------------------------------------

-- Opening a cycle reaches every family at a campus at once, which is a bigger
-- thing than editing one child, so it is its own permission rather than a
-- corner of `students.write`.
insert into public.permissions (code, label, sort_order) values
  ('reenrolment.write', 'Open and close a re-enrolment round', 176)
on conflict (code) do update set label = excluded.label, sort_order = excluded.sort_order;

with grants(role_code, permission_code) as (
  values
    ('admissions_manager', 'reenrolment.write'),
    ('campus_admin',       'reenrolment.write')
)
insert into public.role_permissions (role_id, permission_code)
select r.id, g.permission_code
  from grants g
  join public.roles r on r.code = g.role_code
    on conflict do nothing;

alter table public.reenrolment_cycles enable row level security;
alter table public.reenrolment_responses enable row level security;

-- A cycle with no campus is the whole group's, so anyone who may read the
-- register sees it; a campus cycle is scoped like everything else.
drop policy if exists reenrolment_cycles_select on public.reenrolment_cycles;
create policy reenrolment_cycles_select on public.reenrolment_cycles
  for select using (
    (select public.has_permission('students.read'))
    and (campus_id is null or (select public.can_access_campus(campus_id)))
  );

drop policy if exists reenrolment_cycles_insert on public.reenrolment_cycles;
create policy reenrolment_cycles_insert on public.reenrolment_cycles
  for insert with check (
    (select public.has_permission('reenrolment.write'))
    and (campus_id is null or (select public.can_access_campus(campus_id)))
  );

drop policy if exists reenrolment_cycles_update on public.reenrolment_cycles;
create policy reenrolment_cycles_update on public.reenrolment_cycles
  for update using (
    (select public.has_permission('reenrolment.write'))
    and (campus_id is null or (select public.can_access_campus(campus_id)))
  );

drop policy if exists reenrolment_responses_select on public.reenrolment_responses;
create policy reenrolment_responses_select on public.reenrolment_responses
  for select using (
    (select public.has_permission('students.read'))
    and (select public.can_access_campus(reenrolment_responses.campus_id))
  );

-- Recording an answer a parent gave on the phone is ordinary register work,
-- so it needs `students.write` rather than the power to open a round.
drop policy if exists reenrolment_responses_update on public.reenrolment_responses;
create policy reenrolment_responses_update on public.reenrolment_responses
  for update using (
    (select public.has_permission('students.write'))
    and (select public.can_access_campus(reenrolment_responses.campus_id))
  );

-- No insert policy: responses are written by `open_reenrolment_cycle` under
-- the service role, so the board is always exactly the children in scope and
-- never a hand-picked subset. No delete policy: a family that was asked and
-- did not answer is the finding, not a row to tidy away.
