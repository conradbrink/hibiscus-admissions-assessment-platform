-- School closures and the weekday session schedule.
--
-- The school asked (7 September 2026) for an assessment sitting and a
-- school visit to be bookable every weekday at every campus, except on
-- school holidays. The job drain creates them a few weeks ahead
-- (web/lib/workflow/automation/sessions.ts) from the settings below,
-- skipping any date covered by a closure. Closures are edited under
-- Set up → School holidays; the 2026 term calendar the school supplied is
-- seeded here, school-wide. A closure with a campus applies to that campus
-- alone.

create table if not exists public.school_closures (
  id uuid primary key default gen_random_uuid(),
  -- Null: every campus.
  campus_id uuid references public.campuses(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  label text not null check (length(label) between 1 and 120),
  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create index if not exists school_closures_dates_idx on public.school_closures(starts_on, ends_on);

drop trigger if exists school_closures_set_updated_at on public.school_closures;
create trigger school_closures_set_updated_at
  before update on public.school_closures
  for each row execute function public.set_updated_at();

alter table public.school_closures enable row level security;

-- Any signed-in staff member may read the calendar; settings.write edits it.
drop policy if exists school_closures_select on public.school_closures;
create policy school_closures_select on public.school_closures
  for select using ((select public.current_staff_id()) is not null);

drop policy if exists school_closures_insert on public.school_closures;
create policy school_closures_insert on public.school_closures
  for insert with check (
    (select public.has_permission('settings.write'))
    and created_by = (select auth.uid())
  );

drop policy if exists school_closures_update on public.school_closures;
create policy school_closures_update on public.school_closures
  for update using ((select public.has_permission('settings.write')));

drop policy if exists school_closures_delete on public.school_closures;
create policy school_closures_delete on public.school_closures
  for delete using ((select public.has_permission('settings.write')));

-- The 2026 term calendar, as supplied by the school. Every date between a
-- term's end and the next term's start is a closure, as are the mid-term
-- breaks and the public holidays that fall in term. Seeded only into an
-- empty table so a replay never duplicates what staff have since edited.
insert into public.school_closures (campus_id, starts_on, ends_on, label)
select null, v.starts_on::date, v.ends_on::date, v.label
from (values
  ('2026-01-01', '2026-01-13', 'Before Term 1'),
  ('2026-02-27', '2026-03-02', 'Mid-term break'),
  ('2026-04-03', '2026-05-04', 'Easter and the Term 1 holiday'),
  ('2026-05-14', '2026-05-14', 'Ascension Day'),
  ('2026-06-29', '2026-07-01', 'Mid-term break and Sir Seretse Khama Day'),
  ('2026-07-20', '2026-07-21', 'Presidents'' Day weekend'),
  ('2026-08-08', '2026-09-07', 'Term 2 holiday'),
  ('2026-09-30', '2026-10-01', 'Botswana Day holidays'),
  ('2026-10-30', '2026-11-02', 'Mid-term break'),
  ('2026-12-10', '2027-01-10', 'End-of-year holiday (Term 1 2027 start date to confirm)')
) as v(starts_on, ends_on, label)
where not exists (select 1 from public.school_closures);

-- The schedule. Times are minutes after midnight in school time (UTC+2).
insert into public.settings (key, value, description)
values
  ('auto_sessions_enabled', 'true'::jsonb,
   'Create a published assessment sitting and a school visit every weekday at every active campus, a few weeks ahead, skipping the dates under Set up → School holidays. Off: sessions are created by hand under Set up → Sessions.'),
  ('auto_sessions_weeks_ahead', '6'::jsonb,
   'How many weeks ahead the weekday sessions are kept created.'),
  ('auto_assessment_start_minutes', '540'::jsonb,
   'When the daily assessment sitting starts, in minutes after midnight, school time (540 = 09:00).'),
  ('auto_assessment_duration_minutes', '90'::jsonb,
   'How long the daily assessment sitting lasts, in minutes.'),
  ('auto_visit_start_minutes', '600'::jsonb,
   'When the daily school visit starts, in minutes after midnight, school time (600 = 10:00).'),
  ('auto_visit_duration_minutes', '60'::jsonb,
   'How long the daily school visit lasts, in minutes.'),
  ('auto_session_capacity', '6'::jsonb,
   'Places on each automatically created session.')
on conflict (key) do nothing;
