-- The two ladders collide on age. A child turning four is Grade RR in
-- Potchefstroom and Pre-Reception in Gaborone, and the South African grades
-- sort first, so recommending across the whole catalogue answered every
-- Botswana enquiry with a South African class. The code now recommends from
-- the grades the chosen campus actually offers; this repairs what the old
-- behaviour wrote.
--
-- One application had been placed on Grade RR at Village, which does not
-- offer it — and no Village fee schedule reaches that far down the ladder, so
-- its offer would have found no fees at all.
--
-- The mapping is by age, not by name: each South African class is swapped for
-- the class at the same age_turning that the campus really teaches. Anything
-- at Potchefstroom is left alone; that is where the ladder belongs.
with equivalent as (
  select sa.id as sa_id, bw.id as bw_id
  from grades sa
  join grades bw
    on bw.sort_order between 10 and 50
   and bw.age_turning is not distinct from sa.age_turning
  where sa.sort_order between 1 and 5
)
update applications a
set grade_id = coalesce((select e.bw_id from equivalent e where e.sa_id = a.grade_id), a.grade_id),
    recommended_grade_id = coalesce(
      (select e.bw_id from equivalent e where e.sa_id = a.recommended_grade_id),
      a.recommended_grade_id
    ),
    updated_at = now()
where exists (select 1 from campuses c where c.id = a.campus_id and c.code <> 'potch')
  and (
    exists (select 1 from equivalent e where e.sa_id = a.grade_id)
    or exists (select 1 from equivalent e where e.sa_id = a.recommended_grade_id)
  );
