-- Reception at the five pre-school campuses gets its Ed-admin name.
--
-- 20260909240000_ed_admin_grade_codes wrote the school's mapping only where
-- the campus-and-stage pair already existed. Reception at the pre-schools
-- did not exist until 20260910160000_bana_tlokweng a day later, so those
-- five rows were never named, and the student export refused every child in
-- one of them ("Ed-admin has no name yet for Bana Tlokweng · Reception").
--
-- The names are the ones that migration already carried, copied from
-- Ed-admin's own Grade list. Matched on the campus code, which is stable
-- where the name is not (Tlokweng became Bana Tlokweng), and written only
-- where nothing has been set by hand.
update public.campus_grades cg
   set external_grade_code = m.external_code
  from (values
    ('tlokweng',    'RECEPT-TLK'),
    ('phase2',      'RECEP_PHASE_2'),
    ('phase4',      'REC-HPP'),
    ('sarona_city', 'RECEPT-SARONA'),
    ('village',     'RECEPT-VILLAGE')
  ) as m(campus_code, external_code),
  public.campuses c, public.grades g
 where cg.campus_id = c.id
   and cg.grade_id = g.id
   and c.code = m.campus_code
   and g.code = 'reception'
   and cg.external_grade_code is null;
