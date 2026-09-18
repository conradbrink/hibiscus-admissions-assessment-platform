-- Potchefstroom's fees, corrected against the school's printed sheet.
--
-- 20260917090000 loaded the Potch monthly rates from figures given in a
-- message. The school then sent the printed 2026 fee sheet ("HIBISCUS
-- PRE-SCHOOL & DAY CARE CENTRE, 2026 SCHOOL FEES, POTCHEFSTROOM"), and every
-- figure on it differs. The sheet is the school's own published document and
-- is what families are quoted, so it wins.
--
--                        was          the sheet says
--   Babies to Juniors    2680 / 2980  2470 / 2780, lunch included
--   Grade RR             2400 / 2700  2270 / 2500, lunch 400
--   Grade R              2550 / 2850  2400 / 2650, lunch 400
--   Administration fee   1200         950
--
-- Half day is 07h00 to 13h00 and full day 07h00 to 17h00; the labels say so,
-- because "half day" alone has been read as "until lunch" often enough.
--
-- The administration fee is the one line here payable to accept a place, so
-- this changes what a new offer asks a family for. An offer already drafted
-- keeps the figures it froze — that is the point of the snapshot — so the
-- three Potch offers in flight still quote the old amounts until they are
-- withdrawn and drafted again.
--
-- The sheet covers 2026. The 2027 schedules carried the same numbers as 2026
-- before this and still do: mirroring is better than leaving a year on
-- figures now known to be wrong, and the school can price 2027 when it
-- publishes it.
--
-- Potch's schedules were created in the console, so a database rebuilt from
-- migrations has none and this file changes nothing there.

update public.fee_lines l
   set amount_minor = r.amount_minor,
       label = r.label
  from public.fee_schedules s
  join public.campuses c on c.id = s.campus_id
  join (values
    -- band low, band high, code, label, cents
    (1, 3, 'tuition_month_half', 'Tuition per month (half day 07h00-13h00, lunch included)', 247000),
    (1, 3, 'tuition_month_full', 'Tuition per month (full day 07h00-17h00, lunch included)', 278000),
    (1, 3, 'registration',       'Administration fee',                                        95000),
    (4, 4, 'tuition_month_half', 'Tuition per month (half day 07h00-13h00)',                 227000),
    (4, 4, 'tuition_month_full', 'Tuition per month (full day 07h00-17h00)',                 250000),
    (4, 4, 'lunch_month',        'Lunch per month',                                           40000),
    (4, 4, 'registration',       'Administration fee',                                        95000),
    (5, 5, 'tuition_month_half', 'Tuition per month (half day 07h00-13h00)',                 240000),
    (5, 5, 'tuition_month_full', 'Tuition per month (full day 07h00-17h00)',                 265000),
    (5, 5, 'lunch_month',        'Lunch per month',                                           40000),
    (5, 5, 'registration',       'Administration fee',                                        95000)
  ) as r(gmin, gmax, code, label, amount_minor)
    on r.gmin = s.grade_sort_min and r.gmax = s.grade_sort_max
 where l.schedule_id = s.id
   and c.code in ('potch', 'potch_south')
   and s.status = 'active'
   and l.code = r.code;
