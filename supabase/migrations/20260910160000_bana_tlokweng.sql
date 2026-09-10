-- Bana Tlokweng: its own name, its own classes, its own fees.
--
-- The campus sheet the school hands new parents lists four classes, none of
-- them assessed, and no registration fee. Our data had it as a copy of every
-- other pre-school: no Reception, a P300 registration fee, and one fee band
-- covering classes whose fees differ by P360 a month.

-- 1. The name. Every campus is stored without the school's name in front of
--    it ("Block 7", "Village"), and this one is "Bana Tlokweng".
update campuses set name = 'Bana Tlokweng', updated_at = now()
where code = 'tlokweng' and name = 'Tlokweng';

-- 2. Whether a class is assessed is a fact about the class *at a campus*, not
--    about the class. Reception at Block 7 sits an assessment; Reception at a
--    pre-school is a pre-school class and does not. Null keeps the grade's own
--    answer, so every existing row behaves exactly as before.
alter table campus_grades add column if not exists requires_assessment boolean;

comment on column campus_grades.requires_assessment is
  'Overrides grades.requires_assessment for this campus. Null means the grade decides.';

create or replace function public.create_application(
  p_parent_first_name text, p_parent_last_name text, p_email text, p_email_normalised text,
  p_mobile text, p_mobile_normalised text, p_child_first_name text, p_child_last_name text,
  p_child_date_of_birth date, p_campus_id uuid, p_grade_id uuid, p_recommended_grade_id uuid,
  p_intake_id uuid, p_entry_route text, p_source text default 'website',
  p_current_school text default null, p_current_grade text default null,
  p_heard_from text default null, p_heard_from_detail text default null
)
returns table(application_id uuid, reference text, contact_id uuid, created boolean)
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_contact_id uuid;
  v_application_id uuid;
  v_reference text;
  v_requires boolean;
  v_grade_exists boolean;
begin
  insert into public.contacts (first_name, last_name, email, email_normalised, mobile, mobile_normalised)
  values (
    p_parent_first_name, p_parent_last_name, p_email, p_email_normalised,
    p_mobile, p_mobile_normalised
  )
  on conflict (email_normalised) do update
    set first_name = excluded.first_name,
        last_name = excluded.last_name,
        email = excluded.email,
        mobile = coalesce(excluded.mobile, public.contacts.mobile),
        mobile_normalised = coalesce(excluded.mobile_normalised, public.contacts.mobile_normalised)
  returning id into v_contact_id;

  select a.id, a.reference into v_application_id, v_reference
    from public.applications a
   where a.contact_id = v_contact_id
     and lower(a.child_first_name) = lower(p_child_first_name)
     and lower(a.child_last_name) = lower(p_child_last_name)
     and a.child_date_of_birth = p_child_date_of_birth
     and a.intake_id = p_intake_id
     and a.status <> 'withdrawn'
   limit 1;

  if v_application_id is not null then
    if p_heard_from is not null then
      update public.applications
         set heard_from = p_heard_from,
             heard_from_detail = nullif(p_heard_from_detail, '')
       where id = v_application_id and heard_from is null;
    end if;
    return query select v_application_id, v_reference, v_contact_id, false;
    return;
  end if;

  -- The campus has the final say on whether its class is assessed.
  select true, coalesce(cg.requires_assessment, g.requires_assessment)
    into v_grade_exists, v_requires
    from public.grades g
    left join public.campus_grades cg
      on cg.grade_id = g.id and cg.campus_id = p_campus_id and cg.is_active
   where g.id = p_grade_id;
  if not coalesce(v_grade_exists, false) then
    raise exception 'grade_not_found';
  end if;

  v_reference := public.next_application_reference();

  insert into public.applications (
    reference, contact_id, child_first_name, child_last_name, child_date_of_birth,
    campus_id, grade_id, recommended_grade_id, intake_id, requires_assessment,
    entry_route, source, current_school, current_grade, heard_from, heard_from_detail
  ) values (
    v_reference, v_contact_id, p_child_first_name, p_child_last_name, p_child_date_of_birth,
    p_campus_id, p_grade_id, p_recommended_grade_id, p_intake_id, v_requires,
    p_entry_route, p_source, p_current_school, p_current_grade,
    p_heard_from, nullif(p_heard_from_detail, '')
  )
  returning id into v_application_id;

  insert into public.application_guardians (application_id, contact_id, relationship, is_primary)
  values (v_application_id, v_contact_id, 'parent', true);

  return query select v_application_id, v_reference, v_contact_id, true;
end;
$function$;

revoke execute on function public.create_application(
  text, text, text, text, text, text, text, text, date, uuid, uuid, uuid, uuid, text, text, text, text, text, text
) from public, anon;

-- 3. Reception at the pre-school campuses, unassessed.
insert into campus_grades (campus_id, grade_id, is_active, requires_assessment)
select c.id, g.id, true, false
from campuses c
cross join grades g
where c.code in ('phase2', 'phase4', 'sarona_city', 'village', 'tlokweng')
  and g.code = 'reception'
on conflict (campus_id, grade_id) do update
  set is_active = true, requires_assessment = false;

-- 4. Annual stationery is a published fee and had nowhere to live.
alter table fee_lines drop constraint if exists fee_lines_code_check;
alter table fee_lines add constraint fee_lines_code_check
  check (code in ('registration', 'admission', 'tuition_annual', 'tuition_term', 'tuition_month', 'stationery_annual'));

-- 5. Tlokweng's fees, per class, from the school's own sheet. No registration
--    fee: the sheet says "Registration Fees: None". Nursery is not on the
--    sheet and keeps a schedule with no lines rather than an invented one.
--    The old band is retired rather than deleted: two offers already point at
--    it, and only active schedules are ever resolved.
update fee_schedules
set status = 'draft', name = name || ' (retired)', updated_at = now()
where campus_id = (select id from campuses where code = 'tlokweng')
  and status = 'active';

insert into fee_schedules (campus_id, academic_year_id, name, grade_sort_min, grade_sort_max, currency, status)
select c.id, ay.id, 'Bana Tlokweng · ' || band.label || ' · ' || ay.label, band.lo, band.hi, 'BWP', 'active'
from campuses c
cross join academic_years ay
cross join (values
  ('Nursery', 10, 10),
  ('Pre-Kindergarten', 20, 20),
  ('Kindergarten', 30, 30),
  ('Pre-Reception', 40, 40),
  ('Reception', 50, 50)
) as band(label, lo, hi)
where c.code = 'tlokweng' and ay.label in ('2026', '2027');

insert into fee_lines (schedule_id, code, label, amount_minor, payable_at_acceptance, position)
select fs.id, l.code, l.label, l.amount_minor, false, l.position
from fee_schedules fs
join campuses c on c.id = fs.campus_id
join (values
  (20, 'tuition_month',     'Monthly fees',      159000, 1),
  (20, 'stationery_annual', 'Annual stationery', 185000, 2),
  (30, 'tuition_month',     'Monthly fees',      169000, 1),
  (30, 'stationery_annual', 'Annual stationery', 220000, 2),
  (40, 'tuition_month',     'Monthly fees',      195000, 1),
  (40, 'stationery_annual', 'Annual stationery', 230000, 2),
  (50, 'tuition_month',     'Monthly fees',      195000, 1),
  (50, 'stationery_annual', 'Annual stationery', 250000, 2)
) as l(grade_sort, code, label, amount_minor, position)
  on l.grade_sort = fs.grade_sort_min
where c.code = 'tlokweng';
