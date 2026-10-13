-- Only a scholarship child pays a month up front.
--
-- 20260924080000_first_month_secures_the_place.sql marked the 2027
-- `tuition_month` lines `payable_at_acceptance`, which is what makes the
-- first instalment the condition of accepting a place. It was written for the
-- scholarship programme, but it was written in the wrong place: a fee line
-- belongs to a fee schedule, and a schedule is shared by every child in that
-- class. So an ordinary Stage 3 to 7 family, who today accepts with P 2,300,
-- would have been asked for P 8,200 — the two fees plus a month's tuition —
-- and a Form 3 to 5 family for P 11,700.
--
-- The school's answer, asked directly: the offer applies to the selected
-- scholarship students and to nobody else. This migration is that answer.
--
-- ---------------------------------------------------------------------------
-- Where the requirement belongs instead
-- ---------------------------------------------------------------------------
--
-- The only thing in the system that knows which children are on the
-- programme is the promotion on their application. So the requirement moves
-- onto the promotion, as a new kind of effect: `require_at_acceptance`.
--
-- `applyPromotion` (web/lib/promotions/apply.ts) sets `payable_at_acceptance`
-- on the named line when it sees one. It is the first effect that costs a
-- family money rather than saving it, which is why it is left out of the
-- deal's printed benefit list — but it is the same mechanism as the waivers
-- beside it, resolved per application at the moment the offer is drafted, and
-- frozen into that offer's snapshot with everything else.
--
-- The monthly and yearly lines stay on the schedule. They are true for every
-- family: a Stage 5 year costs P 53,100 whoever is paying it, and the letters
-- of families who are not on the programme are better for saying so. Only
-- *when it falls due* differs, and that is what moves.
--
-- Nothing has been drafted against the earlier migration — no offer on file
-- carries a `tuition_month` line at all — so this corrects a rule before it
-- has priced anything, rather than repricing an offer a family is holding.

-- ---------------------------------------------------------------------------
-- 1. A new kind of effect
-- ---------------------------------------------------------------------------

alter table public.promotion_effects
  drop constraint if exists promotion_effects_kind_check;

alter table public.promotion_effects
  add constraint promotion_effects_kind_check
  check (kind in ('waive_fee', 'discount_fixed', 'discount_percent', 'gift', 'require_at_acceptance'));

-- ---------------------------------------------------------------------------
-- 2. The monthly line is no longer due from everybody
-- ---------------------------------------------------------------------------

update public.fee_lines fl
   set payable_at_acceptance = false
  from public.fee_schedules fs
  join public.academic_years ay on ay.id = fs.academic_year_id
 where fl.schedule_id = fs.id
   and ay.label = '2027'
   and fl.code = 'tuition_month'
   and fl.payable_at_acceptance;

-- ---------------------------------------------------------------------------
-- 3. It is due from a scholarship child
-- ---------------------------------------------------------------------------

-- Position 45: after the discounts that produce the figure (35 and 40), so
-- anyone reading the effects in order sees the amount settled before the line
-- is marked due. The application order does not depend on it — the totals are
-- summed once, after every effect has run — but the reading order is what a
-- person checking the deal in Settings will follow.
insert into public.promotion_effects (promotion_id, position, kind, fee_code, percent, label)
select p.id, 45, 'require_at_acceptance', 'tuition_month', null::numeric,
       'First month payable to confirm the place'
  from public.promotions p
 where p.code like 'SCHOLARSHIP-%'
   and not exists (
     select 1 from public.promotion_effects e
      where e.promotion_id = p.id
        and e.fee_code = 'tuition_month'
        and e.kind = 'require_at_acceptance'
   );

-- ---------------------------------------------------------------------------
-- Prove it
-- ---------------------------------------------------------------------------

do $$
declare
  v_open text;
  v_missing text;
begin
  -- No 2027 schedule asks a month of everybody.
  select string_agg(fs.name, ', ' order by fs.name) into v_open
    from public.fee_lines fl
    join public.fee_schedules fs on fs.id = fl.schedule_id
    join public.academic_years ay on ay.id = fs.academic_year_id
   where ay.label = '2027' and fl.code = 'tuition_month' and fl.payable_at_acceptance;
  if v_open is not null then
    raise exception 'these schedules would bill a month up front to every family: %', v_open;
  end if;

  -- Every band asks it of its own children.
  select string_agg(p.code, ', ' order by p.code) into v_missing
    from public.promotions p
   where p.code like 'SCHOLARSHIP-%' and p.is_active
     and not exists (
       select 1 from public.promotion_effects e
        where e.promotion_id = p.id
          and e.fee_code = 'tuition_month'
          and e.kind = 'require_at_acceptance'
     );
  if v_missing is not null then
    raise exception 'these bands would let a family accept without paying: %', v_missing;
  end if;

  raise notice 'the first instalment is asked of scholarship children and of nobody else';
end $$;
