-- Campuses, grades, the campus × grade matrix, academic years, intakes, and
-- workflow settings.
--
-- The campus × grade matrix is the fix for the current form's worst data
-- problem: its grade dropdown is not filtered by campus, so a parent can pick
-- "Tlokweng — Pre-School" and "Form 4" and nothing stops them. Here a grade is
-- offered at a campus only if a `campus_grades` row says so, and the parent
-- funnel offers nothing else.

-- ---------------------------------------------------------------------------
-- Campuses
-- ---------------------------------------------------------------------------

create table if not exists public.campuses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  -- "Pre-School and Day Care Centre", "Primary & Secondary School". Display
  -- only; what a campus actually offers is `campus_grades`.
  descriptor text,
  -- ⚠️ "Potch — CBD Maury Avenue" is very likely Potchefstroom, South Africa.
  -- Country and currency are per campus from day one so that becoming true
  -- does not require touching every fee and every policy later.
  country text not null default 'BW' check (country in ('BW', 'ZA')),
  currency text not null default 'BWP' check (currency in ('BWP', 'ZAR')),
  address text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists campuses_set_updated_at on public.campuses;
create trigger campuses_set_updated_at
  before update on public.campuses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Grades
-- ---------------------------------------------------------------------------

create table if not exists public.grades (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  phase text not null check (phase in ('pre_school', 'primary', 'secondary')),
  sort_order int not null unique,
  /**
   * The age a child turns before the academic year's cut-off to be placed in
   * this grade. The current site states the rule uniformly as "children
   * turning N before end July", which makes the recommendation deterministic:
   * take the child's age on the cut-off date and match it here. Null means
   * rolling admission with no age rule (Nursery).
   */
  age_turning int check (age_turning between 0 and 20),
  /**
   * "All applicants from Reception through to Secondary level will be required
   * to undergo an assessment." Nursery to Pre-Reception are exempt, and their
   * journey skips the assessment branch entirely. This flag is what the
   * workflow engine reads.
   */
  requires_assessment boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists grades_set_updated_at on public.grades;
create trigger grades_set_updated_at
  before update on public.grades
  for each row execute function public.set_updated_at();

create table if not exists public.campus_grades (
  campus_id uuid not null references public.campuses(id) on delete cascade,
  grade_id uuid not null references public.grades(id) on delete cascade,
  is_active boolean not null default true,
  primary key (campus_id, grade_id)
);

comment on table public.campus_grades is
  'Which grades each campus offers. The parent funnel offers only these combinations.';

-- ---------------------------------------------------------------------------
-- Academic years and intakes
-- ---------------------------------------------------------------------------

create table if not exists public.academic_years (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  starts_on date not null,
  ends_on date not null,
  /**
   * The "before end July" date for this year. A child's age on this date,
   * matched against `grades.age_turning`, is their recommended grade for
   * entry in this academic year.
   */
  age_cutoff_on date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on > starts_on)
);

drop trigger if exists academic_years_set_updated_at on public.academic_years;
create trigger academic_years_set_updated_at
  before update on public.academic_years
  for each row execute function public.set_updated_at();

-- Botswana schools run three terms and children can start at any of them —
-- the current form asks for "Date of entry: Select Start Term". An intake is
-- one term of one academic year. Capacity per campus and grade is a Phase 2
-- concern and will hang off this row when it arrives.
create table if not exists public.intakes (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  term int not null check (term between 1 and 3),
  label text not null,
  starts_on date not null,
  -- Parents may pick this intake in the funnel while open.
  is_open boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academic_year_id, term)
);

drop trigger if exists intakes_set_updated_at on public.intakes;
create trigger intakes_set_updated_at
  before update on public.intakes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

-- The numbers the workflow engine consults: reminder offsets, expiry windows,
-- nudge delays. Configurable because an administrator changing 48 hours to 72
-- must not need a deploy. The *graph* of states is not here, deliberately —
-- see web/lib/workflow.
create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  description text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff_profiles(id) on delete set null
);

drop trigger if exists settings_set_updated_at on public.settings;
create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Campus scoping for staff
-- ---------------------------------------------------------------------------

create table if not exists public.staff_campuses (
  staff_id uuid not null references public.staff_profiles(id) on delete cascade,
  campus_id uuid not null references public.campuses(id) on delete cascade,
  primary key (staff_id, campus_id)
);

comment on table public.staff_campuses is
  'Restricts a member of staff to named campuses. A member of staff with NO rows here sees every campus — head-office admissions is the common case, and a restriction is the exception that gets configured.';

create or replace function public.can_access_campus(p_campus_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    not exists (select 1 from public.staff_campuses where staff_id = auth.uid())
    or exists (
      select 1 from public.staff_campuses
      where staff_id = auth.uid() and campus_id = p_campus_id
    )
$$;

revoke execute on function public.can_access_campus(uuid) from public, anon;
grant execute on function public.can_access_campus(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.campuses enable row level security;
alter table public.grades enable row level security;
alter table public.campus_grades enable row level security;
alter table public.academic_years enable row level security;
alter table public.intakes enable row level security;
alter table public.settings enable row level security;
alter table public.staff_campuses enable row level security;

-- Reference data is readable by every member of staff and editable with
-- settings.write. Parents read it through the service role in the funnel.

drop policy if exists campuses_select on public.campuses;
create policy campuses_select on public.campuses
  for select using ((select public.current_staff_id()) is not null);
drop policy if exists campuses_insert on public.campuses;
create policy campuses_insert on public.campuses
  for insert with check ((select public.has_permission('settings.write')));
drop policy if exists campuses_update on public.campuses;
create policy campuses_update on public.campuses
  for update using ((select public.has_permission('settings.write')));
-- No delete: a campus with applications behind it is history. Deactivate it.

drop policy if exists grades_select on public.grades;
create policy grades_select on public.grades
  for select using ((select public.current_staff_id()) is not null);
drop policy if exists grades_insert on public.grades;
create policy grades_insert on public.grades
  for insert with check ((select public.has_permission('settings.write')));
drop policy if exists grades_update on public.grades;
create policy grades_update on public.grades
  for update using ((select public.has_permission('settings.write')));

drop policy if exists campus_grades_select on public.campus_grades;
create policy campus_grades_select on public.campus_grades
  for select using ((select public.current_staff_id()) is not null);
drop policy if exists campus_grades_insert on public.campus_grades;
create policy campus_grades_insert on public.campus_grades
  for insert with check ((select public.has_permission('settings.write')));
drop policy if exists campus_grades_update on public.campus_grades;
create policy campus_grades_update on public.campus_grades
  for update using ((select public.has_permission('settings.write')));
drop policy if exists campus_grades_delete on public.campus_grades;
create policy campus_grades_delete on public.campus_grades
  for delete using ((select public.has_permission('settings.write')));

drop policy if exists academic_years_select on public.academic_years;
create policy academic_years_select on public.academic_years
  for select using ((select public.current_staff_id()) is not null);
drop policy if exists academic_years_insert on public.academic_years;
create policy academic_years_insert on public.academic_years
  for insert with check ((select public.has_permission('settings.write')));
drop policy if exists academic_years_update on public.academic_years;
create policy academic_years_update on public.academic_years
  for update using ((select public.has_permission('settings.write')));

drop policy if exists intakes_select on public.intakes;
create policy intakes_select on public.intakes
  for select using ((select public.current_staff_id()) is not null);
drop policy if exists intakes_insert on public.intakes;
create policy intakes_insert on public.intakes
  for insert with check ((select public.has_permission('settings.write')));
drop policy if exists intakes_update on public.intakes;
create policy intakes_update on public.intakes
  for update using ((select public.has_permission('settings.write')));

drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings
  for select using ((select public.current_staff_id()) is not null);
drop policy if exists settings_update on public.settings;
create policy settings_update on public.settings
  for update using ((select public.has_permission('settings.write')));
-- No insert or delete for authenticated: the set of keys is defined by
-- migrations, because code reads them by name.

drop policy if exists staff_campuses_select on public.staff_campuses;
create policy staff_campuses_select on public.staff_campuses
  for select using ((select public.current_staff_id()) is not null);
drop policy if exists staff_campuses_insert on public.staff_campuses;
create policy staff_campuses_insert on public.staff_campuses
  for insert with check ((select public.has_permission('staff.write')));
drop policy if exists staff_campuses_delete on public.staff_campuses;
create policy staff_campuses_delete on public.staff_campuses
  for delete using ((select public.has_permission('staff.write')));

-- ---------------------------------------------------------------------------
-- Seed: campuses, grades, matrix, years, intakes, settings
-- ---------------------------------------------------------------------------
--
-- Taken from the current Ed-admin form on 4 September 2026. Where that form
-- contradicts itself, the choice made here is recorded and flagged for the
-- school to confirm — see docs/PROJECT-CONTEXT.md, "Reference data to confirm".

insert into public.campuses (code, name, descriptor, sort_order) values
  ('phase2',      'Phase 2',      'Pre-School and Day Care Centre', 10),
  ('phase4',      'Phase 4',      'Pre-School and Day Care Centre', 20),
  ('sarona_city', 'Sarona City',  'Pre-School and Day Care Centre', 30),
  ('village',     'Village',      'Pre-School and Day Care Centre', 40),
  ('tlokweng',    'Tlokweng',     'Pre-School and Day Care Centre', 50),
  ('broadhurst',  'Broadhurst',   'Primary School',                 60),
  ('block7',      'Block 7',      'Primary & Secondary School',     70),
  ('potch',       'Potch',        'CBD Maury Avenue',               80)
on conflict (code) do nothing;

-- Potch is inactive until the school confirms what it is and which country
-- it is in. An inactive campus is never offered in the funnel.
update public.campuses set is_active = false where code = 'potch';

insert into public.grades (code, name, phase, sort_order, age_turning, requires_assessment) values
  ('nursery',          'Nursery',          'pre_school', 10,  null, false),
  ('pre_kindergarten', 'Pre-Kindergarten', 'pre_school', 20,  2,    false),
  ('kindergarten',     'Kindergarten',     'pre_school', 30,  3,    false),
  ('pre_reception',    'Pre-Reception',    'pre_school', 40,  4,    false),
  ('reception',        'Reception',        'primary',    50,  5,    true),
  ('stage_1',          'Stage 1',          'primary',    60,  6,    true),
  ('stage_2',          'Stage 2',          'primary',    70,  7,    true),
  ('stage_3',          'Stage 3',          'primary',    80,  8,    true),
  ('stage_4',          'Stage 4',          'primary',    90,  9,    true),
  ('stage_5',          'Stage 5',          'primary',    100, 10,   true),
  ('stage_6',          'Stage 6',          'primary',    110, 11,   true),
  -- "Stage7-HPS" is in the dropdown but not in the age table. Seeded inactive
  -- with the age Stage 6 + 1 implies, pending confirmation.
  ('stage_7',          'Stage 7',          'primary',    120, 12,   true),
  ('form_1',           'Form 1',           'secondary',  130, 12,   true),
  ('form_2',           'Form 2',           'secondary',  140, 13,   true),
  ('form_3',           'Form 3',           'secondary',  150, 14,   true),
  -- The current site says Form 4 is also "turning 14", which contradicts
  -- Form 3. 15 is the only value consistent with the rest of the ladder.
  ('form_4',           'Form 4',           'secondary',  160, 15,   true),
  -- "Form 5" is in the dropdown but not in the age table.
  ('form_5',           'Form 5',           'secondary',  170, 16,   true)
on conflict (code) do nothing;

update public.grades set is_active = false where code = 'stage_7';

-- Default matrix, inferred from each campus's descriptor. The dropdown's
-- "-HPS" suffixes on KINDER and PRE-REC suggest pre-school grades are the
-- pre-school campuses' and Reception upward belongs to the schools.
with m(campus_code, grade_code) as (
  select c.code, g.code
  from public.campuses c
  cross join public.grades g
  where
    (c.descriptor = 'Pre-School and Day Care Centre' and g.phase = 'pre_school')
    or (c.code = 'broadhurst' and g.phase = 'primary')
    or (c.code = 'block7' and g.phase in ('primary', 'secondary'))
)
insert into public.campus_grades (campus_id, grade_id)
select c.id, g.id
from m
join public.campuses c on c.code = m.campus_code
join public.grades g on g.code = m.grade_code
on conflict do nothing;

insert into public.academic_years (label, starts_on, ends_on, age_cutoff_on, is_current) values
  ('2026', '2026-01-12', '2026-12-04', '2026-07-31', true),
  ('2027', '2027-01-11', '2027-12-03', '2027-07-31', false)
on conflict (label) do nothing;

-- Term dates are approximate and must be confirmed against the school
-- calendar. Term 1 and 2 of 2026 are in the past and closed.
insert into public.intakes (academic_year_id, term, label, starts_on, is_open, sort_order)
select y.id, t.term, t.label, t.starts_on, t.is_open, t.sort_order
from (values
  ('2026', 1, 'Term 1, 2026', '2026-01-12'::date, false, 10),
  ('2026', 2, 'Term 2, 2026', '2026-05-04'::date, false, 20),
  ('2026', 3, 'Term 3, 2026', '2026-09-07'::date, true,  30),
  ('2027', 1, 'Term 1, 2027', '2027-01-11'::date, true,  40),
  ('2027', 2, 'Term 2, 2027', '2027-05-03'::date, true,  50),
  ('2027', 3, 'Term 3, 2027', '2027-09-06'::date, true,  60)
) as t(year_label, term, label, starts_on, is_open, sort_order)
join public.academic_years y on y.label = t.year_label
on conflict (academic_year_id, term) do nothing;

insert into public.settings (key, value, description) values
  ('booking_token_days',        '14',  'Days a "book my assessment" link stays valid.'),
  ('next_step_token_days',      '90',  'Days a "your next step" link stays valid.'),
  ('assessment_reminder_hours', '[48, 3]', 'Hours before an assessment at which reminders are sent.'),
  ('enquiry_nudge_hours',       '48',  'Hours after an enquiry with no booking before a nudge email is sent.'),
  ('offer_expiry_days',         '14',  'Days a parent has to accept an offer.'),
  ('offer_reminder_days_before','[7, 2]', 'Days before offer expiry at which reminders are sent.'),
  ('parent_session_minutes',    '60',  'How long the cookie a magic link is exchanged for stays valid.')
on conflict (key) do nothing;
