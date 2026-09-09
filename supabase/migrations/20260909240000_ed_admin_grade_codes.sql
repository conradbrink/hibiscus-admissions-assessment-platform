-- The name of a stage in the school's other system, per campus.
--
-- Ed-admin does not have a grade called "Stage 5". It has `Stage5-HPS` at
-- Block 7 and `Stage5-HLA` at Broadhurst, `NURSERY-TLK` at Tlokweng and
-- `NURSERY_PHASE_2` at Phase 2 — the stage and the site, in one string, with
-- a hyphen at some sites and an underscore at others. Its importer matches on
-- the exact word and drops anything else without saying so, which is why
-- every student we exported arrived without a grade and therefore without a
-- family: the row imported, the link did not.
--
-- So the code is stored rather than derived. Deriving it would mean encoding
-- `Stage5-HPS` but `NUR-HPP`, `RECEPT-TLK` but `RECEP_PHASE_2`, and guessing
-- again the next time the school opens a site. A column the school can edit
-- is smaller than the rules would be, and it is right by construction.
--
-- It hangs off `campus_grades` because that is exactly what it identifies:
-- one stage at one campus. A stage the school does not offer at a campus has
-- no row, and needs no code.

alter table public.campus_grades
  add column if not exists external_grade_code text;

comment on column public.campus_grades.external_grade_code is
  'What this stage at this campus is called in Ed-admin (Stage5-HPS, NURSERY-TLK, RECEP_PHASE_2). Copied from its own dropdown; the importer matches the exact string. Null means the pair has not been mapped and the student export will refuse to send it.';

-- ---------------------------------------------------------------------------
-- The mapping the school gave us
-- ---------------------------------------------------------------------------

-- Block 7 is HPS, Broadhurst is HLA, Tlokweng TLK, Village VILLAGE, Sarona
-- City SARONA, Phase 2 PHASE_2 and Phase 4 HPP. Potchefstroom is CBD, whose
-- stages (BABIES_CBD, TODDLERS_CBD, JUNIOR_CBD, GradeRR_CBD, GradeR_CBD) do
-- not correspond to any stage that campus currently offers here, so it is
-- left unmapped on purpose rather than guessed.
--
-- Matched on the campus name and the grade code, and written only where the
-- pair exists: a campus that does not teach a stage is skipped silently, and
-- nothing already set by hand is overwritten.
do $seed$
declare
  m record;
begin
  for m in
    select * from (values
      ('Block 7',     'reception',        'REC-HPS'),
      ('Block 7',     'stage_1',          'Stage1-HPS'),
      ('Block 7',     'stage_2',          'Stage2-HPS'),
      ('Block 7',     'stage_3',          'Stage3-HPS'),
      ('Block 7',     'stage_4',          'Stage4-HPS'),
      ('Block 7',     'stage_5',          'Stage5-HPS'),
      ('Block 7',     'stage_6',          'Stage6-HPS'),
      ('Block 7',     'stage_7',          'Stage7-HPS'),
      ('Block 7',     'form_1',           'Form1-HPS'),
      ('Block 7',     'form_2',           'Form2-HPS'),
      ('Block 7',     'form_3',           'Form3-HPS'),
      ('Block 7',     'form_4',           'Form4-HPS'),
      ('Block 7',     'form_5',           'Form5-HPS'),
      ('Block 7',     'kindergarten',     'KINDER-HPS'),
      ('Block 7',     'pre_reception',    'PRE-REC-HPS'),

      ('Broadhurst',  'reception',        'REC-HLA'),
      ('Broadhurst',  'stage_1',          'Stage1-HLA'),
      ('Broadhurst',  'stage_2',          'Stage2-HLA'),
      ('Broadhurst',  'stage_3',          'Stage3-HLA'),
      ('Broadhurst',  'stage_4',          'Stage4-HLA'),
      ('Broadhurst',  'stage_5',          'Stage5-HLA'),
      ('Broadhurst',  'stage_6',          'Stage6-HLA'),
      ('Broadhurst',  'stage_7',          'Stage7-HLA'),

      ('Tlokweng',    'nursery',          'NURSERY-TLK'),
      ('Tlokweng',    'pre_kindergarten', 'PRE-K-TLK'),
      ('Tlokweng',    'kindergarten',     'KINDER-TLK'),
      ('Tlokweng',    'pre_reception',    'PRE-REC-TLK'),
      ('Tlokweng',    'reception',        'RECEPT-TLK'),

      ('Village',     'nursery',          'NURSERY-VILLAGE'),
      ('Village',     'pre_kindergarten', 'PRE-K-VILLAGE'),
      ('Village',     'kindergarten',     'KINDER-VILLAGE'),
      ('Village',     'pre_reception',    'PRE-REC-VILLAGE'),
      ('Village',     'reception',        'RECEPT-VILLAGE'),

      ('Sarona City', 'nursery',          'NURSERY-SARONA'),
      ('Sarona City', 'pre_kindergarten', 'PRE-K-SARONA'),
      ('Sarona City', 'kindergarten',     'KINDER-SARONA'),
      ('Sarona City', 'pre_reception',    'PRE-REC-SARONA'),
      ('Sarona City', 'reception',        'RECEPT-SARONA'),

      ('Phase 2',     'nursery',          'NURSERY_PHASE_2'),
      ('Phase 2',     'pre_kindergarten', 'PRE-K_PHASE_2'),
      ('Phase 2',     'kindergarten',     'KINDER_PHASE_2'),
      ('Phase 2',     'pre_reception',    'PRE-REC_PHASE_2'),
      ('Phase 2',     'reception',        'RECEP_PHASE_2'),

      ('Phase 4',     'nursery',          'NUR-HPP'),
      ('Phase 4',     'pre_kindergarten', 'PREK-HPP'),
      ('Phase 4',     'kindergarten',     'KIN-HPP'),
      ('Phase 4',     'pre_reception',    'PRER-HPP'),
      ('Phase 4',     'reception',        'REC-HPP')
    ) as t(campus_name, grade_code, external_code)
  loop
    update public.campus_grades cg
       set external_grade_code = m.external_code
      from public.campuses c, public.grades g
     where cg.campus_id = c.id
       and cg.grade_id = g.id
       and c.name = m.campus_name
       and g.code = m.grade_code
       and cg.external_grade_code is null;
  end loop;
end
$seed$;
