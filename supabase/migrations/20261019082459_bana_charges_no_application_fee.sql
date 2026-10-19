-- Bana Tlokweng charges no application fee.
--
-- The campus sheet says "Registration Fees: None", and
-- 20260910160000_bana_tlokweng.sql built every Bana schedule that way. The
-- 2026 schedules still are. The five 2027 ones are not: each carries a
-- `registration` line of P300, payable at acceptance, that no migration in
-- this repository wrote. The letter prints that code as "Application fee
-- (non-refundable)", so every 2027 Bana family was asked for P300 on top of
-- the first month — P1,890 rather than P1,590 for Pre-Kindergarten — and the
-- school has said again (19 October 2026) that Bana charges none.
--
-- ---------------------------------------------------------------------------
-- 1. No application fee at Bana, in any year
-- ---------------------------------------------------------------------------
--
-- By campus rather than by year, because the instruction was "the whole of
-- Bana": a 2028 schedule copied from 2027 should not bring the line back.
-- Retired (draft) schedules too, so one reactivated in the admin does not
-- either.

delete from public.fee_lines fl
 using public.fee_schedules fs
 join public.campuses c on c.id = fs.campus_id
 where fl.schedule_id = fs.id
   and c.code = 'tlokweng'
   and fl.code = 'registration';

-- ---------------------------------------------------------------------------
-- 2. Nursery 2027 is priced as Nursery 2026
-- ---------------------------------------------------------------------------
--
-- The P300 was the only line on `Bana Tlokweng · Nursery · 2027`. Without it
-- the schedule is empty, which `onOfferDrafted` treats as no schedule: a
-- Nursery offer would stop at "Configure fees", and the three already waiting
-- for approval would have nothing to ask for.
--
-- The school's answer, asked directly: Nursery 2027 costs what Nursery 2026
-- does, P1,590 a month with the first month paid to accept — the same as
-- Pre-Kindergarten in both years. Written as a figure rather than copied from
-- the 2026 row, because that row was entered in the admin and a replay from
-- empty would copy nothing.

insert into public.fee_lines (schedule_id, code, label, amount_minor, payable_at_acceptance, position)
select fs.id, 'tuition_month', 'Monthly fees', 159000, true, 3
  from public.fee_schedules fs
  join public.campuses c on c.id = fs.campus_id
  join public.academic_years ay on ay.id = fs.academic_year_id
 where c.code = 'tlokweng'
   and ay.label = '2027'
   and fs.grade_sort_min = 10
   and fs.status = 'active'
on conflict (schedule_id, code) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Letters already drafted
-- ---------------------------------------------------------------------------
--
-- An offer freezes its fees when it is drafted, so none of this reaches a
-- letter already written. Those still waiting for approval are brought onto
-- the schedules as they now are by `web/scripts/redraft-offers-run.test.ts`
-- (REDRAFT_CAMPUSES=tlokweng REDRAFT_YEAR=2027), through `onOfferDrafted`,
-- as the re-draft button does. No Bana letter carrying the P300 had been
-- accepted or paid.

-- ---------------------------------------------------------------------------
-- Prove it
-- ---------------------------------------------------------------------------

do $$
declare
  v_charged text;
  v_unpriced text;
begin
  select string_agg(fs.name, ', ' order by fs.name) into v_charged
    from public.fee_lines fl
    join public.fee_schedules fs on fs.id = fl.schedule_id
    join public.campuses c on c.id = fs.campus_id
   where c.code = 'tlokweng' and fl.code = 'registration';
  if v_charged is not null then
    raise exception 'these Bana Tlokweng schedules still charge an application fee: %', v_charged;
  end if;

  -- Bana is priced by the month and the first month secures the place
  -- (20260924151255): every active 2027 schedule must still ask for one.
  select string_agg(fs.name, ', ' order by fs.name) into v_unpriced
    from public.fee_schedules fs
    join public.campuses c on c.id = fs.campus_id
    join public.academic_years ay on ay.id = fs.academic_year_id
   where c.code = 'tlokweng' and ay.label = '2027' and fs.status = 'active'
     and not exists (
       select 1 from public.fee_lines fl
        where fl.schedule_id = fs.id and fl.code = 'tuition_month' and fl.payable_at_acceptance
     );
  if v_unpriced is not null then
    raise exception 'these Bana Tlokweng 2027 schedules would secure a place without the first month: %', v_unpriced;
  end if;

  raise notice 'Bana Tlokweng charges no application fee, and every 2027 class still asks for its first month';
end $$;
