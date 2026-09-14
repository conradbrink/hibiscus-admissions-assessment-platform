-- ---------------------------------------------------------------------------
-- Assessment starts at Stage 1, and Phase 2 re-prices
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Reception no longer sits an assessment
-- ---------------------------------------------------------------------------

-- The original policy read "all applicants from Reception through to Secondary
-- level will be required to undergo an assessment", and Reception was seeded
-- `requires_assessment = true` on the strength of it. It has not been true in
-- practice for a while: Reception is taught at the pre-school campuses, is
-- priced with the pre-school grades, and was already excluded from the learner
-- code of conduct. Five campuses carried a per-campus override saying so.
--
-- The school has now settled it in one direction for every campus, Block 7
-- included: Stage 1 (sort_order 60) is the first assessed year. So the grade
-- itself says it, rather than five overrides saying it campus by campus.
--
-- This matters more than a flag. `applications_sync_requires_assessment` is a
-- BEFORE INSERT trigger that reads `grades` alone, so the grade row is what
-- every new enquiry actually gets — the campus override never survived the
-- insert. Putting the truth in the grade is the only place it takes effect.
update public.grades
   set requires_assessment = false, updated_at = now()
 where sort_order = 50
   and requires_assessment;

-- The overrides are now redundant, and a redundant override is a second place
-- to look when the answer changes. Null means "the grade decides", which is
-- what we want it to do.
update public.campus_grades cg
   set requires_assessment = null
  from public.grades g
 where g.id = cg.grade_id
   and g.sort_order = 50
   and cg.requires_assessment is not null;

-- The Reception papers go with it. Retired, not deleted: sittings that have
-- already happened point at these templates, and the story content itself
-- (web/content/story/garden.json) is untouched, so reversing this is one
-- status change rather than a re-seed.
update public.assessment_templates
   set status = 'retired', updated_at = now()
 where grade_sort_min = 50
   and grade_sort_max = 50
   and status <> 'retired';

-- ---------------------------------------------------------------------------
-- Phase 2 term fees
-- ---------------------------------------------------------------------------

-- Amounts are minor units (thebe), so 780000 is P7,800.00. Both the 2026 and
-- 2027 schedules move together: they are priced identically today and the
-- school set one price list, not two.
--
-- Only tuition moves. The P300 application fee is left alone.

-- Nursery, Pre-Kindergarten and Kindergarten: 8,700/9,400 -> 7,800/8,700.
update public.fee_lines fl
   set amount_minor = case fl.code
         when 'tuition_term_half' then 780000
         when 'tuition_term_full' then 870000
       end
  from public.fee_schedules fs
  join public.campuses c on c.id = fs.campus_id
 where fs.id = fl.schedule_id
   and c.code = 'phase2'
   and fs.grade_sort_min = 10
   and fs.grade_sort_max = 30
   and fl.code in ('tuition_term_half', 'tuition_term_full');

-- Pre-Reception and Reception: the half day comes down to 8,700; the full day
-- stays at 10,790 and is restated so the pair reads as one price list rather
-- than one edited line.
update public.fee_lines fl
   set amount_minor = case fl.code
         when 'tuition_term_half' then 870000
         when 'tuition_term_full' then 1079000
       end
  from public.fee_schedules fs
  join public.campuses c on c.id = fs.campus_id
 where fs.id = fl.schedule_id
   and c.code = 'phase2'
   and fs.grade_sort_min = 40
   and fs.grade_sort_max = 50
   and fl.code in ('tuition_term_half', 'tuition_term_full');
