-- Every campus has an owner, and every new application lands on their badge.
--
-- Until now `applications.owner_staff_id` was set by hand, one applicant at a
-- time, from the select on the applicant page. It shows: of 185 applications
-- on file, 142 have no owner at all. An unowned application is not a small
-- untidiness — `/staff/applications?mine=1` is how a person finds their own
-- work, an automation's "assign the application's owner" resolves to nobody,
-- and a task raised for the owner has no badge to land on.
--
-- The school named one person per campus. That is a fact about the campus, not
-- about each child, so it is stored on the campus and applied by a trigger
-- rather than typed 185 times and then forgotten on the 186th.
--
-- ---------------------------------------------------------------------------
-- Why a trigger and not the enquiry code
-- ---------------------------------------------------------------------------
--
-- Applications are created down several paths: the parent's enquiry form, a
-- staff member adding one by hand, the CRM's ed-admin import, and the
-- scholarship importer, all of which go through `create_application`. Putting
-- the default in one of those callers would leave the others unowned, and the
-- next path somebody adds would be unowned too. A `before insert` trigger is
-- the only place that covers all of them at once, including the ones not
-- written yet.
--
-- It only ever fills a blank. An owner passed in explicitly wins, so staff
-- reassigning an applicant on their page is untouched, and so is the importer
-- if it ever names one.
--
-- ---------------------------------------------------------------------------
-- What it deliberately does not do
-- ---------------------------------------------------------------------------
--
--   * **No backfill.** The school asked for this "moving forward". The 142
--     unowned applications on file are a separate decision — some are
--     withdrawn or enrolled and giving them an owner now would put finished
--     work on somebody's list — so they are left alone and can be assigned in
--     a second pass if the school wants it.
--   * **It will not assign to somebody who cannot log in.** The default is
--     used only while that staff profile is active. A person who leaves stops
--     collecting applications the day their account is deactivated, rather
--     than silently accruing a queue nobody reads.

-- ---------------------------------------------------------------------------
-- 1. The campus carries its owner
-- ---------------------------------------------------------------------------

alter table public.campuses
  add column if not exists default_owner_staff_id uuid
    references public.staff_profiles(id) on delete set null;

comment on column public.campuses.default_owner_staff_id is
  'Who new applications at this campus are assigned to. Applied by applications_set_default_owner on insert, only while that staff profile is active, and only when no owner was given.';

-- ---------------------------------------------------------------------------
-- 2. The nine the school named
-- ---------------------------------------------------------------------------

-- Matched on the campus name and the person's full name, then checked. Every
-- one of these people is already the sole owner of applications at their own
-- campus, which is how the short names the school used — "Gao", "Fiona",
-- "Jolinda", "Dorie" — were resolved to accounts rather than guessed at.
do $$
declare
  r record;
  v_campus uuid;
  v_staff uuid;
  v_unmatched text := '';
begin
  -- A database with nobody in it is a fresh replay, not a school that has
  -- lost its staff: CI builds the schema from these migrations alone and
  -- invites nobody. There is no owner to name there, and demanding one would
  -- fail every build. Where people *do* exist, every one of the nine must
  -- resolve — a half-applied list is the failure this check exists for.
  if not exists (select 1 from public.staff_profiles) then
    raise notice 'no staff profiles yet: campus owners will be set when the school invites them';
    return;
  end if;

  for r in
    select * from (values
      ('Block 7',             'Larona Keokgale'),
      ('Broadhurst',          'Gaolatlhe Mothibedi'),
      ('Sarona City',         'Sanet Coetzer'),
      ('Village',             'Maria Fourie'),
      ('Bana Tlokweng',       'Fionah Makopola'),
      ('Phase 4',             'Susan Ryan'),
      ('Potch Maury Avenue',  'Jolandi Venter'),
      ('Potch Rivier Street', 'Louisa Smith'),
      ('Phase 2',             'Kayla Oswald')
    ) as t(campus, person)
  loop
    select id into v_campus from public.campuses where name = r.campus;
    select id into v_staff from public.staff_profiles where full_name = r.person and is_active;

    if v_campus is null then
      v_unmatched := v_unmatched || E'\n  - no campus named "' || r.campus || '"';
    elsif v_staff is null then
      v_unmatched := v_unmatched || E'\n  - no active staff member named "' || r.person || '" for ' || r.campus;
    else
      update public.campuses set default_owner_staff_id = v_staff, updated_at = now() where id = v_campus;
    end if;
  end loop;

  -- Named rather than counted: "8 of 9 matched" sends somebody hunting, while
  -- the name that did not match is the whole answer.
  if v_unmatched <> '' then
    raise exception 'the campus owners could not all be resolved:%', v_unmatched;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Louisa works the campus she owns
-- ---------------------------------------------------------------------------

-- She was on Potch Maury Avenue, which Jolandi already covers, and the school
-- put her on Potch Rivier Street. Ownership and access are separate tables, and
-- owning applications at a campus you cannot open is worse than not owning
-- them: the work lands on a badge and then 404s.
do $$
declare
  v_staff uuid;
  v_maury uuid;
  v_rivier uuid;
begin
  if not exists (select 1 from public.staff_profiles) then
    return;
  end if;

  select id into v_staff from public.staff_profiles where full_name = 'Louisa Smith' and is_active;
  select id into v_maury from public.campuses where name = 'Potch Maury Avenue';
  select id into v_rivier from public.campuses where name = 'Potch Rivier Street';
  if v_staff is null or v_maury is null or v_rivier is null then
    raise exception 'cannot move Louisa Smith: staff %, Maury %, Rivier %', v_staff, v_maury, v_rivier;
  end if;

  insert into public.staff_campuses (staff_id, campus_id) values (v_staff, v_rivier)
  on conflict do nothing;
  delete from public.staff_campuses where staff_id = v_staff and campus_id = v_maury;
end $$;

-- ---------------------------------------------------------------------------
-- 4. The trigger
-- ---------------------------------------------------------------------------

create or replace function public.applications_set_default_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Only ever fills a blank: an owner given explicitly is the caller's
  -- decision and outranks the campus default.
  if new.owner_staff_id is null and new.campus_id is not null then
    select c.default_owner_staff_id
      into new.owner_staff_id
      from public.campuses c
      join public.staff_profiles sp on sp.id = c.default_owner_staff_id and sp.is_active
     where c.id = new.campus_id;
  end if;
  return new;
end $$;

-- A trigger function is not an API. It runs as definer so the parent's own
-- enquiry can read the campus row, which makes it worth calling directly if
-- anybody could — so nobody can. Same lockdown as
-- `applications_sync_requires_assessment` beside it, and the security suite
-- fails the build without it.
revoke all on function public.applications_set_default_owner() from public, anon, authenticated;

drop trigger if exists applications_set_default_owner on public.applications;
create trigger applications_set_default_owner
  before insert on public.applications
  for each row execute function public.applications_set_default_owner();

-- ---------------------------------------------------------------------------
-- Prove it
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing text;
begin
  if not exists (select 1 from public.staff_profiles) then
    raise notice 'schema-only database: the trigger is in place, and the owners follow the people';
    return;
  end if;

  -- Every active campus names somebody who can log in.
  select string_agg(c.name, ', ' order by c.name) into v_missing
    from public.campuses c
   where c.is_active
     and not exists (
       select 1 from public.staff_profiles sp
        where sp.id = c.default_owner_staff_id and sp.is_active
     );
  if v_missing is not null then
    raise exception 'these active campuses would still create unowned applications: %', v_missing;
  end if;

  -- Louisa can open what she owns.
  if not exists (
    select 1 from public.staff_campuses sc
      join public.staff_profiles sp on sp.id = sc.staff_id
      join public.campuses c on c.id = sc.campus_id
     where sp.full_name = 'Louisa Smith' and c.name = 'Potch Rivier Street'
  ) then
    raise exception 'Louisa Smith owns Potch Rivier Street but has no access to it';
  end if;

  raise notice 'every active campus has an owner who can log in, and new applications will land on their badge';
end $$;
