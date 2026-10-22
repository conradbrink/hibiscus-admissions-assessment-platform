-- A 5% discount on tuition, for staff to give on the offer.
--
-- Asked for by the school on 20 October 2026: a selection on the offer for
-- 5% off. The school's answer, asked directly: 5% off tuition only. The
-- application and admission fees stay as they are, and nothing more is due on
-- acceptance. That is a plain discount, not a scholarship band: a band also
-- waives both fees, asks for the first month up front and sends the
-- scholarship letter, none of which this is.
--
-- It is a promotion like every other deal, so the arithmetic, the snapshot on
-- the letter and the letter's "welcome offer" lines all come from machinery
-- that already works. Staff choose it beside the scholarship bands in Edit
-- offer (`setScholarship`), or from the Offers board's promotion picker. Like
-- any deal it replaces whatever deal the child held: there is only ever one.
--
-- The code is the contract, as `SCHOLARSHIP-` is: `DISCOUNT-<n>` is a staff
-- discount of n% (web/lib/promotions/discount.ts), and a parent who types it on
-- the enquiry form is told the code is not recognised. A promotion with a code
-- is otherwise open to whoever types it, and one without a code is applied by
-- rule to every family it matches, so neither shape alone keeps it staff-only.
--
-- No window and no campus or grade: the school decides who it is for, one
-- family at a time, and a deal that closed on a date would quietly stop being
-- offered on the screen.

-- ---------------------------------------------------------------------------
-- 1. The promotion
-- ---------------------------------------------------------------------------

insert into public.promotions (code, name, letter_text, is_active)
values ('DISCOUNT-5', '5% discount on tuition', null, true)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Its effects: every tuition line, whichever a schedule uses
-- ---------------------------------------------------------------------------

-- A schedule quotes tuition by the year, the term or the month, and a
-- pre-school one by half or full day as well. An effect on a line the
-- schedule does not have does nothing (`applyPromotion` skips it), so naming
-- all seven is what makes it 5% wherever the child is. The labels are what
-- the letter prints under the deal.
insert into public.promotion_effects (promotion_id, position, kind, fee_code, percent, label)
select p.id, e.position, 'discount_percent', e.fee_code, 5, e.label
  from public.promotions p
  cross join (values
    (10, 'tuition_annual', '5% off the year''s tuition'),
    (20, 'tuition_term', '5% off the term fee'),
    (21, 'tuition_term_half', '5% off the half-day term fee'),
    (22, 'tuition_term_full', '5% off the full-day term fee'),
    (30, 'tuition_month', '5% off the monthly fee'),
    (31, 'tuition_month_half', '5% off the half-day monthly fee'),
    (32, 'tuition_month_full', '5% off the full-day monthly fee')
  ) as e(position, fee_code, label)
 where p.code = 'DISCOUNT-5'
   and not exists (
     select 1 from public.promotion_effects x
      where x.promotion_id = p.id and x.fee_code = e.fee_code
   );

-- ---------------------------------------------------------------------------
-- 3. Prove it is whole
-- ---------------------------------------------------------------------------

-- Both inserts above are no-ops on a repeat, and a silent no-op is how a
-- discount that discounts nothing would reach a letter.
do $$
begin
  if not exists (
    select 1
      from public.promotions p
      join public.promotion_effects e on e.promotion_id = p.id
     where p.code = 'DISCOUNT-5' and p.is_active
       and e.kind = 'discount_percent' and e.percent = 5 and e.fee_code like 'tuition%'
     group by p.id
    having count(*) = 7
  ) or exists (
    select 1
      from public.promotions p
      join public.promotion_effects e on e.promotion_id = p.id
     where p.code = 'DISCOUNT-5' and (e.fee_code is null or e.fee_code not like 'tuition%')
  ) then
    raise exception 'DISCOUNT-5 must be active with exactly its seven 5%% tuition effects, and nothing else';
  end if;
end;
$$;
