-- Potchefstroom's application fee is R1,200 in 2026 and 2027, called the
-- "2026/2027 admission fee".
--
-- 20261013124006_potch_2027_administration_fee.sql set the 2027 line to
-- R1,200 and left 2026 at R950. The school asked on 22 October 2026 for
-- every application fee from now on to be R1,200, under one name for both
-- years, at both Potch sites (Maury Avenue and Rivier Street). It matters
-- now because families are starting in November and December 2026: a month
-- in 2026 is priced from the 2026 schedule, and that still asked for R950
-- under the name "Administration fee".
--
-- The code stays `registration`, which is what the letter, the payment
-- request and the reports read. Only the amount and the label change.
--
-- Draft (retired) schedules too, so one reactivated in the admin does not
-- bring R950 back. Other years are left alone: the label names these two.
--
-- An offer freezes its fees when it is drafted. Letters waiting for approval
-- were redrafted onto the new figure the same day; letters already with a
-- family keep what they were sent.
--
-- Potch's schedules were created in the console, so a database rebuilt from
-- migrations has none and this file changes nothing there.

update public.fee_lines l
   set amount_minor = 120000,
       label = '2026/2027 admission fee'
  from public.fee_schedules s
  join public.campuses c on c.id = s.campus_id
  join public.academic_years ay on ay.id = s.academic_year_id
 where l.schedule_id = s.id
   and c.code in ('potch', 'potch_south')
   and ay.label in ('2026', '2027')
   and l.code = 'registration';

-- ---------------------------------------------------------------------------
-- Prove it
-- ---------------------------------------------------------------------------

do $$
declare
  v_wrong text;
begin
  select string_agg(format('%s (%s): %s %s', s.name, c.code, l.label, l.amount_minor / 100), ', ' order by c.code, s.name)
    into v_wrong
    from public.fee_lines l
    join public.fee_schedules s on s.id = l.schedule_id
    join public.campuses c on c.id = s.campus_id
    join public.academic_years ay on ay.id = s.academic_year_id
   where c.code in ('potch', 'potch_south')
     and ay.label in ('2026', '2027')
     and l.code = 'registration'
     and (l.amount_minor <> 120000 or l.label <> '2026/2027 admission fee');
  if v_wrong is not null then
    raise exception 'these Potch application fees are not R1,200 "2026/2027 admission fee": %', v_wrong;
  end if;
  raise notice 'every Potch 2026 and 2027 application fee is R1,200, called the 2026/2027 admission fee';
end $$;
