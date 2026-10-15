-- Potchefstroom's 2027 fees, from the school's printed 2027 sheet.
--
-- 20260918080000_potch_fees_from_the_printed_sheet.sql priced 2026 from the
-- printed 2026 sheet and mirrored those figures into 2027 until the school
-- published 2027; 20261013124006 then set the 2027 administration fee to
-- R1,200. The school has now sent the printed 2027 sheet ("HIBISCUS
-- PRE-SCHOOL & DAY CARE CENTRE, 2027 SCHOOL FEES, POTCHEFSTROOM"), and every
-- monthly figure on it differs from what 2027 carried:
--
--                        was          the sheet says
--   Babies to Juniors    2470 / 2780  2680 / 2980, lunch included
--   Grade RR             2270 / 2500  2400 / 2700, lunch 500 (was 400)
--   Grade R              2400 / 2650  2550 / 2850, lunch 500 (was 400)
--   Administration fee   1200         1200, unchanged
--
-- They are the figures 20260917090000 first loaded from the school's message,
-- which were 2027's all along. 2026 is untouched. Half day is still 07h00 to
-- 13h00 and full day 07h00 to 17h00, so the labels stand. The sheet's
-- eleven-month duration needs no line: the letter quotes the month.
--
-- None of these lines is payable on acceptance, so what a family pays to
-- accept a 2027 place is unchanged; what the letter quotes per month is not.
-- An offer already drafted keeps the figures it froze — that is the point of
-- the snapshot — so a 2027 Potch offer drafted before this still quotes the
-- 2026 rates until it is withdrawn and drafted again.
--
-- Potch's schedules were created in the console, so a database rebuilt from
-- migrations has none and this file changes nothing there.

update public.fee_lines l
   set amount_minor = r.amount_minor
  from public.fee_schedules s
  join public.campuses c on c.id = s.campus_id
  join public.academic_years ay on ay.id = s.academic_year_id
  join (values
    -- band low, band high, code, cents
    (1, 3, 'tuition_month_half', 268000),
    (1, 3, 'tuition_month_full', 298000),
    (4, 4, 'tuition_month_half', 240000),
    (4, 4, 'tuition_month_full', 270000),
    (4, 4, 'lunch_month',         50000),
    (5, 5, 'tuition_month_half', 255000),
    (5, 5, 'tuition_month_full', 285000),
    (5, 5, 'lunch_month',         50000)
  ) as r(gmin, gmax, code, amount_minor)
    on r.gmin = s.grade_sort_min and r.gmax = s.grade_sort_max
 where l.schedule_id = s.id
   and c.code in ('potch', 'potch_south')
   and ay.label = '2027'
   and s.status = 'active'
   and l.code = r.code;
