-- Bana Tlokweng still pays its first month, and the instalment is final.
--
-- ---------------------------------------------------------------------------
-- 1. A campus priced by the month, caught by a rule about terms
-- ---------------------------------------------------------------------------
--
-- 20260924120000_only_a_scholarship_pays_up_front.sql moved the first
-- instalment off the fee schedule and onto the scholarship promotion, because
-- a schedule is shared by every child in a class and the requirement is not.
-- It cleared `payable_at_acceptance` from **every** 2027 `tuition_month` line
-- to do it.
--
-- That was one word too wide. Bana Tlokweng is priced by the month rather than
-- by the term, and has always asked for the first month to secure a place: its
-- 2026 schedules say so, and eleven Bana offers on file — six of them accepted
-- — carry a payable `tuition_month` in their frozen snapshot. The 2027
-- schedules said the same until that migration turned them off.
--
-- Nothing has gone wrong yet: every Bana offer on file is a 2026 one, and a
-- frozen snapshot does not change under a family. But the next 2027 Bana offer
-- would have asked a parent for the application and admission fees alone and
-- called the place secured, which is not what that campus charges.
--
-- The four rows go back. The rule that should have been written the first time
-- is the one written here: only a schedule that **quotes a term** was ever in
-- scope, because those are the schedules 20260924080000 added a monthly line
-- to. A campus that quotes months natively was never part of this change.

update public.fee_lines fl
   set payable_at_acceptance = true
  from public.fee_schedules fs
  join public.academic_years ay on ay.id = fs.academic_year_id
 where fl.schedule_id = fs.id
   and ay.label = '2027'
   and fl.code = 'tuition_month'
   and not fl.payable_at_acceptance
   -- The distinguishing fact, not the campus name: a schedule that quotes a
   -- term is one whose monthly line we invented, and only those were meant to
   -- change. Naming Bana would fix today and miss the next campus like it.
   and not exists (
     select 1 from public.fee_lines t where t.schedule_id = fs.id and t.code = 'tuition_term'
   );

-- ---------------------------------------------------------------------------
-- 2. The instalment that confirms the place is not refundable
-- ---------------------------------------------------------------------------

-- The school asked for this to be on the letter, and it belongs beside the
-- number rather than only in the terms overleaf. The terms already said fees
-- are not refundable; a parent deciding whether to pay reads the paragraph
-- under the table, not the small print.
--
-- Anchored on the exact sentence and checked, for the same reason as the
-- invitation rewording: a `replace` that matches nothing changes nothing and
-- says nothing about it.
do $$
declare
  v_old constant text := 'That is the whole year divided into nine: the first instalment is due now, and the school invoices the other eight, the last of them in August 2027.';
  v_new constant text := 'That is the whole year divided into nine: the first instalment is due now and is <strong>not refundable</strong>, and the school invoices the other eight, the last of them in August 2027.';
  v_hit int;
begin
  update public.offer_templates
     set body_html = replace(body_html, v_old, v_new),
         updated_at = now()
   where key = 'scholarship'
     and position(v_old in body_html) > 0;

  get diagnostics v_hit = row_count;
  if v_hit = 0 then
    raise exception 'the scholarship letter no longer carries the instalment sentence this anchors on; check the wording by hand in Offer templates';
  end if;

  raise notice 'scholarship offer letter: % row(s) now say the first instalment is not refundable', v_hit;
end $$;

-- ---------------------------------------------------------------------------
-- Prove it
-- ---------------------------------------------------------------------------

do $$
declare
  v_open text;
  v_shut text;
  v_silent text;
begin
  -- A schedule that quotes a term must not ask a month of everybody: that is
  -- the scholarship promotion's job, and the check 20260924120000 already made.
  select string_agg(fs.name, ', ' order by fs.name) into v_open
    from public.fee_lines fl
    join public.fee_schedules fs on fs.id = fl.schedule_id
    join public.academic_years ay on ay.id = fs.academic_year_id
   where ay.label = '2027' and fl.code = 'tuition_month' and fl.payable_at_acceptance
     and exists (select 1 from public.fee_lines t where t.schedule_id = fs.id and t.code = 'tuition_term');
  if v_open is not null then
    raise exception 'these term-priced schedules would bill a month up front to every family: %', v_open;
  end if;

  -- A campus priced by the month must still ask for one.
  select string_agg(fs.name, ', ' order by fs.name) into v_shut
    from public.fee_lines fl
    join public.fee_schedules fs on fs.id = fl.schedule_id
    join public.academic_years ay on ay.id = fs.academic_year_id
   where ay.label = '2027' and fs.status = 'active'
     and fl.code = 'tuition_month' and not fl.payable_at_acceptance
     and not exists (select 1 from public.fee_lines t where t.schedule_id = fs.id and t.code = 'tuition_term');
  if v_shut is not null then
    raise exception 'these monthly-priced schedules would secure a place without the first month: %', v_shut;
  end if;

  select string_agg(t.key, ', ') into v_silent
    from public.offer_templates t
   where t.key = 'scholarship' and t.is_active
     and position('not refundable' in t.body_html) = 0;
  if v_silent is not null then
    raise exception 'the scholarship letter does not say the instalment is not refundable: %', v_silent;
  end if;

  raise notice 'term-priced schedules ask nothing up front, monthly campuses still ask for their month, and the letter says the instalment is final';
end $$;
