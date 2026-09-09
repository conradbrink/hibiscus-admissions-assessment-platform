-- Potchefstroom's own stages, and a title for the person registering.
--
-- Two things Ed-admin's vocabulary turned up.
--
-- 1. Potchefstroom is priced (six fee schedules) but teaches nothing: it has
--    no campus_grades rows at all, so its stage list is empty and no parent
--    can apply to it. It is also in South Africa, and Ed-admin knows it as
--    CBD, whose stages are the South African early years — Babies, Toddlers,
--    Junior, Grade RR, Grade R — not the Botswana ladder every other campus
--    uses. Those get their own five stages rather than being bent onto
--    Nursery through Reception, because the ages are not the same question:
--    a school's Babies room is not somebody else's Nursery.
--
-- 2. Ed-admin requires a title and a sex for each guardian, and its Relation
--    list is gendered throughout — `Guardian (female)` and `Guardian (male)`,
--    `Grandmother` and `Grandfather`, with no neutral form of either. We ask
--    a parent for their relationship to the child and nothing else, so a
--    guardian or a grandparent had no word we could send, and every title we
--    sent for them was blank. Asking for a title fixes all three columns at
--    once and is a normal thing to ask.

-- ---------------------------------------------------------------------------
-- 1. The South African early years, at Potchefstroom
-- ---------------------------------------------------------------------------

-- Sorted 1 to 5, below the Botswana ladder that starts at 10. Order only ever
-- matters within one campus's own list, and Potchefstroom shows these five
-- alone.
--
-- The ages mirror the South African convention and the ladder already here
-- (Grade RR at four, Grade R at five). None of them requires an assessment:
-- the sittings are written for the Botswana stages, and a school that wants
-- one at Potchefstroom can turn it on once there is something to sit.
insert into public.grades (name, code, phase, sort_order, age_turning, requires_assessment, is_active) values
  ('Babies',   'babies',   'pre_school', 1, null, false, true),
  ('Toddlers', 'toddlers', 'pre_school', 2, 2,    false, true),
  ('Junior',   'junior',   'pre_school', 3, 3,    false, true),
  ('Grade RR', 'grade_rr', 'pre_school', 4, 4,    false, true),
  ('Grade R',  'grade_r',  'pre_school', 5, 5,    false, true)
on conflict (code) do update set
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_active = true;

-- Offered at Potchefstroom and nowhere else, each carrying the name Ed-admin
-- knows it by.
do $potch$
declare
  v_campus uuid;
  m record;
begin
  select id into v_campus from public.campuses where name in ('Potch', 'Potchefstroom') limit 1;
  if v_campus is null then
    raise notice 'No Potchefstroom campus; skipping its stages.';
    return;
  end if;

  for m in
    select * from (values
      ('babies',   'BABIES_CBD'),
      ('toddlers', 'TODDLERS_CBD'),
      ('junior',   'JUNIOR_CBD'),
      ('grade_rr', 'GradeRR_CBD'),
      ('grade_r',  'GradeR_CBD')
    ) as t(grade_code, external_code)
  loop
    insert into public.campus_grades (campus_id, grade_id, is_active, external_grade_code)
    select v_campus, g.id, true, m.external_code
      from public.grades g where g.code = m.grade_code
    on conflict (campus_id, grade_id) do update set
      is_active = true,
      external_grade_code = coalesce(public.campus_grades.external_grade_code, excluded.external_grade_code);
  end loop;
end
$potch$;

-- ---------------------------------------------------------------------------
-- 2. A guardian's title
-- ---------------------------------------------------------------------------

alter table public.registration_contacts
  add column if not exists title text;

comment on column public.registration_contacts.title is
  'How the guardian is addressed (Mr, Mrs, Dr, Professor). Asked at registration because Ed-admin requires it, and because its Relation list is gendered — a title is what tells us whether a guardian is Guardian (female) or Guardian (male) without guessing from a first name.';
