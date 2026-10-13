-- Potchefstroom's 2027 administration fee is R1,200.
--
-- 20260918080000_potch_fees_from_the_printed_sheet.sql set the fee to R950
-- from the printed 2026 sheet and mirrored it into 2027, to be priced when
-- the school published 2027. The school has now done so for this line: R1,200
-- for 2027. 2026 stays at R950, and every other 2027 Potch figure is
-- unchanged.
--
-- The fee is payable to accept a place, so this changes what a new 2027 Potch
-- offer asks a family for. An offer already drafted keeps the figure it froze
-- — that is the point of the snapshot — so a 2027 Potch offer drafted before
-- this still quotes R950 until it is withdrawn and drafted again.
--
-- Potch's schedules were created in the console, so a database rebuilt from
-- migrations has none and this file changes nothing there.

update public.fee_lines l
   set amount_minor = 120000
  from public.fee_schedules s
  join public.campuses c on c.id = s.campus_id
  join public.academic_years ay on ay.id = s.academic_year_id
 where l.schedule_id = s.id
   and c.code in ('potch', 'potch_south')
   and ay.label = '2027'
   and s.status = 'active'
   and l.code = 'registration';
