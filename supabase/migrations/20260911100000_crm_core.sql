-- The child, after the funnel.
--
-- Until now the product stopped at `enrolled`. `states.ts` lists no move out
-- of it, the engine cannot even withdraw from it, and the last thing that
-- happened was a frozen `student_records.snapshot` and two spreadsheets typed
-- into another system by hand. After that the family disappeared.
--
-- Everything the school does next — the onboarding checklist, the first day,
-- the WhatsApp group, asking each term whether the child is coming back — is
-- about a child who is enrolled once and then stays for eight years, with
-- siblings, across campuses. An application is the wrong thing to hang that
-- on: it is how one child arrived, in one term, and it is terminal by design.
--
-- So three rows arrive that outlive an application:
--
--   families    the account, which siblings share. `contacts.family_code`
--               already meant this; it becomes a row.
--   students    the child, for as long as the school has them.
--   enrolments  one per student per academic year: where they are, in which
--               grade, and whether they are coming back.
--
-- `applications` is demoted to provenance (`origin_application_id`). Nothing
-- about the funnel changes: `commit_transition()` is still the only writer of
-- `applications.status`, and `enrolled` is still terminal. This starts where
-- that stops rather than extending its graph.

-- ---------------------------------------------------------------------------
-- Families
-- ---------------------------------------------------------------------------

create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  -- The same code `20260909160000_family_codes.sql` mints onto a contact, and
  -- the same one the other system bills. Read on a statement, so readable.
  family_code text not null,
  -- The surname the school would say out loud. Editable, because "Coetzer /
  -- van der Merwe" is one family with two names and only a person can say
  -- which one the school uses.
  display_name text,
  home_address text,
  -- Where the family's own record lives in the school's other system, once
  -- the import tells us. Filled in later; the join has to exist first.
  external_ref text,
  -- Two parents who enquired separately are one family. The loser of a merge
  -- keeps its row and its code, because that code has already been exported.
  merged_into_id uuid references public.families(id) on delete restrict,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Unique among live families only. A merged-away family keeps the code the
-- other system was already told; making the column globally unique would
-- either forbid the merge or force us to rewrite history.
create unique index if not exists families_code_live_idx
  on public.families(family_code) where merged_into_id is null;
create index if not exists families_merged_idx
  on public.families(merged_into_id) where merged_into_id is not null;

drop trigger if exists families_set_updated_at on public.families;
create trigger families_set_updated_at
  before update on public.families
  for each row execute function public.set_updated_at();

comment on table public.families is
  'The account siblings share. Promoted from contacts.family_code, which stays as the value the school''s other system knows.';

alter table public.contacts
  add column if not exists family_id uuid references public.families(id) on delete restrict;
create index if not exists contacts_family_idx on public.contacts(family_id);

comment on column public.contacts.family_id is
  'The family this contact belongs to. family_code remains the external value; this is the internal key.';

-- Everyone already here. Distinct codes become families; the contacts follow.
insert into public.families (family_code, display_name)
select c.family_code, min(c.last_name)
  from public.contacts c
 where c.family_code is not null
group by c.family_code
    on conflict do nothing;

update public.contacts c
   set family_id = f.id
  from public.families f
 where c.family_id is null
   and c.family_code = f.family_code
   and f.merged_into_id is null;

-- ---------------------------------------------------------------------------
-- The two family-code triggers, taught about the row
-- ---------------------------------------------------------------------------

-- `20260909160000` cannot be edited, but its functions can be replaced — the
-- same move `dashboard_counts()` has already had four times. The minting is
-- unchanged, verbatim; what is added is the row the code now names.
create or replace function public.contacts_set_family_code()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_family uuid;
begin
  if new.family_code is null then
    new.family_code := public.next_family_code(new.last_name);
  end if;

  if new.family_id is null then
    select id into v_family
      from public.families
     where family_code = new.family_code and merged_into_id is null;
    if v_family is null then
      insert into public.families (family_code, display_name)
      values (new.family_code, new.last_name)
      returning id into v_family;
    end if;
    new.family_id := v_family;
  end if;

  return new;
end;
$$;

-- Merging now moves rows, not just a string: the contact, and every student
-- already under the losing family. The losing row stays, pointing at the
-- survivor, so an old export can still be explained.
create or replace function public.merge_family_code(p_contact_id uuid, p_into_code text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old text;
  v_old_family uuid;
  v_new_family uuid;
begin
  select id into v_new_family
    from public.families where family_code = p_into_code and merged_into_id is null;
  if v_new_family is null then
    raise exception 'No family has the code %.', p_into_code;
  end if;

  select family_code, family_id into v_old, v_old_family
    from public.contacts where id = p_contact_id;
  if not found then
    raise exception 'No contact %.', p_contact_id;
  end if;
  if v_old = p_into_code then
    return p_into_code;
  end if;

  perform set_config('app.family_code_merge', 'on', true);
  update public.contacts
     set family_code = p_into_code, family_id = v_new_family
   where id = p_contact_id;
  perform set_config('app.family_code_merge', 'off', true);

  if v_old_family is not null and v_old_family <> v_new_family then
    update public.students set family_id = v_new_family where family_id = v_old_family;
    -- Only when nobody is left behind: a family with two contacts merges one
    -- at a time, and the row dies with the last of them.
    if not exists (select 1 from public.contacts where family_id = v_old_family) then
      update public.families set merged_into_id = v_new_family, updated_at = now()
       where id = v_old_family;
    end if;
  end if;

  return p_into_code;
end;
$$;

revoke execute on function public.merge_family_code(uuid, text) from public, anon, authenticated;

-- An old code still finds the live family, however many merges ago it was.
create or replace function public.family_id_for_code(p_code text)
returns uuid
language sql
stable
security invoker
set search_path = public
as $$
  with recursive walk as (
    select id, merged_into_id from public.families where family_code = p_code
    union all
    select f.id, f.merged_into_id from public.families f join walk w on f.id = w.merged_into_id
  )
  select id from walk where merged_into_id is null limit 1
$$;

revoke execute on function public.family_id_for_code(text) from public, anon;
grant execute on function public.family_id_for_code(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Class groups — the table now, the allocation later
-- ---------------------------------------------------------------------------

create table if not exists public.class_groups (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid not null references public.campuses(id) on delete restrict,
  grade_id uuid not null references public.grades(id) on delete restrict,
  academic_year_id uuid not null references public.academic_years(id) on delete restrict,
  name text not null,
  -- A teacher is not a user of this system yet, so the name is text. When
  -- teachers sign in, this becomes a reference and the text is the fallback.
  teacher_name text,
  room text,
  capacity int check (capacity is null or capacity > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campus_id, grade_id, academic_year_id, name)
);

drop trigger if exists class_groups_set_updated_at on public.class_groups;
create trigger class_groups_set_updated_at
  before update on public.class_groups
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Students
-- ---------------------------------------------------------------------------

create sequence if not exists public.student_code_seq;

create or replace function public.next_student_code()
returns text
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$
  select format('HBS-S-%s', lpad(nextval('public.student_code_seq')::text, 5, '0'))
$$;

revoke execute on function public.next_student_code() from public, anon, authenticated;

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete restrict,
  student_code text not null unique,
  -- How this child arrived. Nullable and `set null`, because deleting a
  -- mistyped applicant must never delete a real child, and because a future
  -- direct admission has no application at all.
  origin_application_id uuid unique references public.applications(id) on delete set null,
  external_ref text,

  -- The same shape `registrations` collects, on purpose: the parent has
  -- already filled it in and `buildStudentRecord` already knows how to read
  -- it. The difference is that a registration belongs to one application and
  -- this belongs to the child.
  legal_first_name text not null,
  legal_middle_names text,
  legal_last_name text not null,
  preferred_name text,
  gender text,
  date_of_birth date not null,
  nationality text,
  country_of_birth text,
  place_of_birth text,
  home_language text,
  identity_type text check (identity_type is null or identity_type in ('omang', 'passport', 'birth_certificate', 'other')),
  identity_number text,

  -- Medical facts are living, not frozen: an allergy found in Term 2 belongs
  -- here, and the enrolment snapshot keeps saying what was true in Term 1.
  medical_aid_name text,
  medical_aid_number text,
  medical_aid_principal_member text,
  emergency_treatment_consent boolean,
  allergies text,
  medical_conditions text,
  medication text,
  medical_notes text,
  vaccination_notes text,

  -- Denormalised from the newest live enrolment by trigger, and not null,
  -- because the row's own campus is what the read policy asks about. Reaching
  -- through `enrolments` on every read would put a two-table exists in every
  -- policy the CRM adds; `tasks.campus_id` already set this precedent.
  current_campus_id uuid not null references public.campuses(id) on delete restrict,
  current_grade_id uuid references public.grades(id) on delete set null,

  status text not null default 'onboarding' check (status in (
    'onboarding',   -- enrolled, has not started
    'active',       -- attending
    'on_leave',
    'left',
    'graduated'
  )),
  left_on date,
  leave_reason text,
  -- When a parent last confirmed the details above are still right. The
  -- termly refresh sets it; a stale one is what the school chases.
  details_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists students_family_idx on public.students(family_id);
create index if not exists students_campus_idx on public.students(current_campus_id);
create index if not exists students_status_idx on public.students(status);
create index if not exists students_name_idx on public.students(legal_last_name, legal_first_name);

drop trigger if exists students_set_updated_at on public.students;
create trigger students_set_updated_at
  before update on public.students
  for each row execute function public.set_updated_at();

comment on table public.students is
  'The child, for as long as the school has them. An application is how they arrived; this is who they are.';

-- ---------------------------------------------------------------------------
-- Enrolments — one per student per academic year
-- ---------------------------------------------------------------------------

create table if not exists public.enrolments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id) on delete restrict,
  -- The term they start in, for the first year. Null for a year they simply
  -- continue into.
  intake_id uuid references public.intakes(id) on delete set null,
  campus_id uuid not null references public.campuses(id) on delete restrict,
  grade_id uuid not null references public.grades(id) on delete restrict,
  class_group_id uuid references public.class_groups(id) on delete set null,
  origin_application_id uuid references public.applications(id) on delete set null,

  -- The full set for every stage is listed now, so a later stage adds code
  -- rather than a constraint change — the same reasoning as `applications`.
  status text not null default 'pending' check (status in (
    'pending',        -- a place held for a year not yet started
    'active',
    'not_returning',  -- the parent told us, and the year is still running
    'left',
    'completed',
    'transferred'
  )),
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, academic_year_id)
);

create index if not exists enrolments_student_idx on public.enrolments(student_id);
create index if not exists enrolments_campus_year_idx on public.enrolments(campus_id, academic_year_id);
create index if not exists enrolments_class_idx on public.enrolments(class_group_id) where class_group_id is not null;

drop trigger if exists enrolments_set_updated_at on public.enrolments;
create trigger enrolments_set_updated_at
  before update on public.enrolments
  for each row execute function public.set_updated_at();

-- The student's campus follows their newest live enrolment, so the read
-- policy and the register never disagree with where the child actually is.
-- A child who has left or graduated keeps that status: only the two live
-- states are recomputed.
create or replace function public.enrolments_sync_student_placement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campus uuid;
  v_grade uuid;
  v_started boolean;
begin
  select e.campus_id, e.grade_id, (e.starts_on is not null and e.starts_on <= (now() at time zone 'Africa/Gaborone')::date)
    into v_campus, v_grade, v_started
    from public.enrolments e
    join public.academic_years y on y.id = e.academic_year_id
   where e.student_id = new.student_id
     and e.status in ('pending', 'active')
   order by y.starts_on desc nulls last, e.created_at desc
   limit 1;

  if v_campus is not null then
    update public.students s
       set current_campus_id = v_campus,
           current_grade_id = v_grade,
           status = case when s.status in ('onboarding', 'active')
                         then case when v_started then 'active' else 'onboarding' end
                    else s.status end,
           updated_at = now()
     where s.id = new.student_id;
  end if;
  return null;
end;
$$;

drop trigger if exists enrolments_sync_student_placement on public.enrolments;
create trigger enrolments_sync_student_placement
  after insert or update of campus_id, grade_id, status, starts_on, academic_year_id on public.enrolments
  for each row execute function public.enrolments_sync_student_placement();

-- ---------------------------------------------------------------------------
-- Who may see a child
-- ---------------------------------------------------------------------------

-- For the tables that hang off a student and carry no campus of their own.
create or replace function public.can_access_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.students s
     where s.id = p_student_id
       and public.can_access_campus(s.current_campus_id)
  )
$$;

revoke execute on function public.can_access_student(uuid) from public, anon;
grant execute on function public.can_access_student(uuid) to authenticated;

insert into public.permissions (code, label, sort_order) values
  ('students.read',  'View students, families and the school year', 172),
  ('students.write', 'Edit a student, a family and an enrolment',   174)
on conflict (code) do update set label = excluded.label, sort_order = excluded.sort_order;

with grants(role_code, permission_code) as (
  values
    ('admissions_manager', 'students.read'),
    ('admissions_manager', 'students.write'),
    ('admissions_staff',   'students.read'),
    ('admissions_staff',   'students.write'),
    ('campus_admin',       'students.read'),
    ('campus_admin',       'students.write'),
    ('management',         'students.read'),
    -- Who is returning next term is a budget question, and there is no money
    -- in these tables to guard.
    ('finance',            'students.read')
)
insert into public.role_permissions (role_id, permission_code)
select r.id, g.permission_code
  from grants g
  join public.roles r on r.code = g.role_code
    on conflict do nothing;

alter table public.families enable row level security;
alter table public.students enable row level security;
alter table public.enrolments enable row level security;
alter table public.class_groups enable row level security;

-- A family has no campus of its own; it is reachable through a child at a
-- campus you may see, or — before any child is enrolled — through the
-- application that is still in the funnel. The second arm mirrors
-- `contacts_select` exactly, which is where a family comes from.
drop policy if exists families_select on public.families;
create policy families_select on public.families
  for select using (
    (
      (select public.has_permission('students.read'))
      and exists (
        select 1 from public.students s
         where s.family_id = families.id
           and (select public.can_access_campus(s.current_campus_id))
      )
    )
    or (
      (select public.has_permission('applications.read'))
      and exists (
        select 1 from public.contacts c
          join public.applications a on a.contact_id = c.id
         where c.family_id = families.id
           and (select public.can_access_campus(a.campus_id))
      )
    )
  );

drop policy if exists families_update on public.families;
create policy families_update on public.families
  for update using (
    (select public.has_permission('students.write'))
    and exists (
      select 1 from public.students s
       where s.family_id = families.id
         and (select public.can_access_campus(s.current_campus_id))
    )
  );

-- No insert policy: a family is minted by the trigger on `contacts`, under
-- the service role, at the moment the family first appears. No delete policy:
-- a family that existed is a fact the register depends on.

drop policy if exists students_select on public.students;
create policy students_select on public.students
  for select using (
    (select public.has_permission('students.read'))
    and (select public.can_access_campus(students.current_campus_id))
  );

drop policy if exists students_update on public.students;
create policy students_update on public.students
  for update using (
    (select public.has_permission('students.write'))
    and (select public.can_access_campus(students.current_campus_id))
  );

-- No insert policy. A student is created by the engine at enrolment, under
-- the service role, from a registration a person already checked. Typing a
-- child straight into the register would skip every one of those checks.
-- No delete policy: leaving is a status.

drop policy if exists enrolments_select on public.enrolments;
create policy enrolments_select on public.enrolments
  for select using (
    (select public.has_permission('students.read'))
    and (select public.can_access_campus(enrolments.campus_id))
  );

drop policy if exists enrolments_insert on public.enrolments;
create policy enrolments_insert on public.enrolments
  for insert with check (
    (select public.has_permission('students.write'))
    and (select public.can_access_campus(campus_id))
  );

drop policy if exists enrolments_update on public.enrolments;
create policy enrolments_update on public.enrolments
  for update using (
    (select public.has_permission('students.write'))
    and (select public.can_access_campus(campus_id))
  );

drop policy if exists class_groups_select on public.class_groups;
create policy class_groups_select on public.class_groups
  for select using (
    (select public.has_permission('students.read'))
    and (select public.can_access_campus(campus_id))
  );

drop policy if exists class_groups_insert on public.class_groups;
create policy class_groups_insert on public.class_groups
  for insert with check (
    (select public.has_permission('students.write'))
    and (select public.can_access_campus(campus_id))
  );

drop policy if exists class_groups_update on public.class_groups;
create policy class_groups_update on public.class_groups
  for update using (
    (select public.has_permission('students.write'))
    and (select public.can_access_campus(campus_id))
  );

-- ---------------------------------------------------------------------------
-- Retention has to be told
-- ---------------------------------------------------------------------------

-- `anonymise_application()` is the only thing that removes personal data, and
-- an enrolled child is not an abandoned enquiry: erasing their registration,
-- documents and agreements would gut the record the CRM now shows.
--
-- The guard is a trigger rather than a hundred lines of that function copied
-- into this file. Anonymising stamps `anonymised_at` as its first write, so
-- this fires inside the same transaction and takes the whole thing with it —
-- and it also catches any future path that tries the same thing.
create or replace function public.applications_refuse_anonymise_enrolled()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.anonymised_at is not null and old.anonymised_at is null
     and exists (select 1 from public.students s where s.origin_application_id = new.id) then
    raise exception 'application_enrolled';
  end if;
  return new;
end;
$$;

drop trigger if exists applications_refuse_anonymise_enrolled on public.applications;
create trigger applications_refuse_anonymise_enrolled
  before update of anonymised_at on public.applications
  for each row execute function public.applications_refuse_anonymise_enrolled();

comment on function public.anonymise_application(uuid) is
  'Removes the person and keeps the figures. Refuses an application a student was enrolled from: see the trigger applications_refuse_anonymise_enrolled.';

-- ---------------------------------------------------------------------------
-- Every child already enrolled
-- ---------------------------------------------------------------------------

-- The snapshot is pinned at schema_version 1 and is the only structured
-- record of these children, so it is what they are built from. A child whose
-- application was anonymised is skipped: there is nobody left to promote.
do $backfill$
declare
  r record;
  v_student uuid;
  v_family uuid;
begin
  for r in
    select sr.application_id,
           sr.snapshot,
           a.contact_id,
           a.campus_id,
           a.grade_id,
           a.intake_id,
           i.academic_year_id,
           i.starts_on
      from public.student_records sr
      join public.applications a on a.id = sr.application_id
      join public.intakes i on i.id = a.intake_id
     where a.status = 'enrolled'
       and a.anonymised_at is null
       and not exists (select 1 from public.students s where s.origin_application_id = sr.application_id)
     order by sr.generated_at
  loop
    select family_id into v_family from public.contacts where id = r.contact_id;
    if v_family is null then
      continue;
    end if;

    insert into public.students (
      family_id, student_code, origin_application_id,
      legal_first_name, legal_middle_names, legal_last_name, preferred_name,
      gender, date_of_birth, nationality, country_of_birth, place_of_birth, home_language,
      identity_type, identity_number,
      medical_aid_name, medical_aid_number, medical_aid_principal_member,
      emergency_treatment_consent, allergies, medical_conditions, medication,
      medical_notes, vaccination_notes,
      current_campus_id, current_grade_id
    ) values (
      v_family,
      public.next_student_code(),
      r.application_id,
      coalesce(r.snapshot->'student'->>'legal_first_name', 'Unknown'),
      r.snapshot->'student'->>'legal_middle_names',
      coalesce(r.snapshot->'student'->>'legal_last_name', 'Unknown'),
      r.snapshot->'student'->>'preferred_name',
      r.snapshot->'student'->>'gender',
      coalesce((r.snapshot->'student'->>'date_of_birth')::date, date '1900-01-01'),
      r.snapshot->'student'->>'nationality',
      r.snapshot->'student'->>'country_of_birth',
      r.snapshot->'student'->>'place_of_birth',
      r.snapshot->'student'->>'home_language',
      nullif(r.snapshot->'student'->>'identity_type', ''),
      r.snapshot->'student'->>'identity_number',
      r.snapshot->'medical'->>'medical_aid_name',
      r.snapshot->'medical'->>'medical_aid_number',
      r.snapshot->'medical'->>'medical_aid_principal_member',
      (r.snapshot->'medical'->>'emergency_treatment_consent')::boolean,
      r.snapshot->'medical'->>'allergies',
      r.snapshot->'medical'->>'medical_conditions',
      r.snapshot->'medical'->>'medication',
      r.snapshot->'medical'->>'medical_notes',
      r.snapshot->'medical'->>'vaccination_notes',
      r.campus_id,
      r.grade_id
    )
    returning id into v_student;

    insert into public.enrolments (
      student_id, academic_year_id, intake_id, campus_id, grade_id,
      origin_application_id, status, starts_on
    ) values (
      v_student, r.academic_year_id, r.intake_id, r.campus_id, r.grade_id,
      r.application_id, 'pending', r.starts_on
    )
    on conflict (student_id, academic_year_id) do nothing;
  end loop;
end
$backfill$;
