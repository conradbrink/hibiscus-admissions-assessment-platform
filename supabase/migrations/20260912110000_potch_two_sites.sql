-- Potchefstroom becomes two sites.
--
-- The campus called "Potch" is the one in the CBD, and the school has opened a
-- second one, Potch South. Same country, same currency, same age range, same
-- prices — so the second is seeded from the first rather than typed in again,
-- which is also the only way to be sure the two agree on the day they open.
--
-- The `code` stays `potch`. A code is an identifier: `staff_campuses`,
-- `fee_schedules` and every application already point at this row, and renaming
-- the identifier to match the label is how those references get orphaned. Only
-- the name a parent reads changes — the same way Tlokweng was renamed.

update public.campuses
   set name = 'Potch CBD'
 where code = 'potch' and name = 'Potch';

-- The new site, with the school's own maps link. Address and phone are
-- deliberately left empty: they have not been given, and a second site wearing
-- the CBD's address would send a family to the wrong gate. Both are filled in
-- Set up → Campuses, and until then the site shows its name and its map.
insert into public.campuses (code, name, descriptor, country, currency, maps_url, sort_order, is_active)
select 'potch_south', 'Potch South', c.descriptor, c.country, c.currency,
       'https://maps.app.goo.gl/Bcru51tABdoNMBtQ6', c.sort_order + 1, true
  from public.campuses c
 where c.code = 'potch'
on conflict (code) do nothing;

-- The same ages, with their own capacity to fill in later.
insert into public.campus_grades (campus_id, grade_id, is_active, capacity, external_grade_code, requires_assessment)
select new_c.id, cg.grade_id, cg.is_active, cg.capacity, cg.external_grade_code, cg.requires_assessment
  from public.campus_grades cg
  join public.campuses old_c on old_c.id = cg.campus_id and old_c.code = 'potch'
  cross join public.campuses new_c
 where new_c.code = 'potch_south'
on conflict (campus_id, grade_id) do nothing;

-- The same prices, copied rather than shared. Two sites that charge the same
-- today are still two sites, and the school must be able to change one without
-- silently changing the other.
--
-- A loop rather than one insert...select, because the lines have to follow
-- their own schedule. Matching the copies back to their sources by name would
-- need `(campus_id, name, academic_year_id)` to be unique, which nothing
-- guarantees; two schedules sharing a name would then cross-join and give both
-- copies every line from both. Carrying the source id through a loop cannot
-- get that wrong.
do $$
declare
  v_new uuid;
  v_src record;
  v_copy uuid;
begin
  select id into v_new from public.campuses where code = 'potch_south';
  if v_new is null then return; end if;

  -- All or nothing, and only onto a site that has no prices yet. A per-schedule
  -- guard keyed on the name looks more careful and is not: Potchefstroom runs
  -- two "Pre-school" schedules split by grade band, so the second would be
  -- skipped as already copied and that site would quietly charge nothing for
  -- half its ages. Once the school has edited these, this must not touch them
  -- either.
  if exists (select 1 from public.fee_schedules where campus_id = v_new) then return; end if;

  for v_src in
    select f.id, f.name, f.academic_year_id, f.grade_sort_min, f.grade_sort_max, f.currency, f.status
      from public.fee_schedules f
      join public.campuses c on c.id = f.campus_id and c.code = 'potch'
      order by f.name, f.grade_sort_min nulls first
  loop
    insert into public.fee_schedules (name, campus_id, academic_year_id, grade_sort_min, grade_sort_max, currency, status)
    values (v_src.name, v_new, v_src.academic_year_id, v_src.grade_sort_min, v_src.grade_sort_max, v_src.currency, v_src.status)
    returning id into v_copy;

    insert into public.fee_lines (schedule_id, code, label, amount_minor, payable_at_acceptance, position)
    select v_copy, l.code, l.label, l.amount_minor, l.payable_at_acceptance, l.position
      from public.fee_lines l
     where l.schedule_id = v_src.id;
  end loop;
end $$;
