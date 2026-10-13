-- The 10% band, which the school added after the others were built.
--
-- 20260922140000_the_2027_scholarship_intake.sql created four bands — 50, 40,
-- 30 and 20 — because that was every band the secondary list used. The primary
-- list has five: 12 at 50%, 14 at 40%, 25 at 30%, 22 at 20% and **19 at 10%**.
--
-- Nothing in the application code needs changing for it. `loadPromotionIds`
-- reads `like 'SCHOLARSHIP-%'` and `scholarshipPercent` parses the number out
-- of the code, so a band is a row rather than a branch. The importer refuses a
-- row whose band has no promotion, which is the right failure — it would have
-- refused all 19 of these tomorrow with "no promotion SCHOLARSHIP-10" — but it
-- is a failure nobody should have to see, so the row goes in first.
--
-- Deliberately not scoped to a campus or a grade band, for the same reason as
-- the other four: one programme, two campuses, and a campus-scoped deal would
-- need duplicating the day the other cohort uses it.

-- ---------------------------------------------------------------------------
-- 1. The promotion
-- ---------------------------------------------------------------------------

-- The same window as its four siblings, to the day. These are not five deals
-- that happen to resemble each other; they are one scholarship programme with
-- five bands, and a band that opened or closed on its own date would be a
-- quiet trap for whoever administers the last of them.
insert into public.promotions (code, name, letter_text, starts_on, ends_on, is_active)
values
  ('SCHOLARSHIP-10', 'Scholarship — 10%',
   'This place is held under the Hibiscus scholarship programme, which covers 10% of tuition.',
   date '2026-09-22', date '2027-01-31', true)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 2. What it is worth
-- ---------------------------------------------------------------------------

-- Three effects, in the order a parent reads them: what they do not pay to
-- accept the place, then what the award is worth each term. The two waivers
-- are the same for every band — a scholarship family is not asked for an
-- application or admission fee whatever the percentage — and only the tuition
-- discount moves.
insert into public.promotion_effects (promotion_id, position, kind, fee_code, percent, label)
select p.id, e.position, e.kind, e.fee_code, e.percent, e.label
from public.promotions p
join (values
  ('SCHOLARSHIP-10', 10, 'waive_fee', 'registration', null::numeric, 'Application fee waived'),
  ('SCHOLARSHIP-10', 20, 'waive_fee', 'admission', null, 'Admission fee waived'),
  ('SCHOLARSHIP-10', 30, 'discount_percent', 'tuition_term', 10, 'Scholarship — 10% of tuition')
) as e(code, position, kind, fee_code, percent, label) on e.code = p.code
where not exists (
  select 1 from public.promotion_effects x where x.promotion_id = p.id and x.position = e.position
);

-- ---------------------------------------------------------------------------
-- 3. Prove the set is whole
-- ---------------------------------------------------------------------------

-- The five bands the primary list uses, each with its three effects. A band
-- that is missing here is 19 families refused tomorrow with a message about a
-- promotion code, which is a poor way to find out. Checked at apply time
-- rather than trusted, because the insert above is `on conflict do nothing`
-- and a silent no-op is exactly what this is guarding against.
do $$
declare
  v_missing text;
begin
  select string_agg(code, ', ' order by code) into v_missing
    from (values ('SCHOLARSHIP-10'), ('SCHOLARSHIP-20'), ('SCHOLARSHIP-30'), ('SCHOLARSHIP-40'), ('SCHOLARSHIP-50')) as want(code)
   where not exists (
     select 1
       from public.promotions p
       join public.promotion_effects e on e.promotion_id = p.id
      where p.code = want.code and p.is_active
      group by p.id
     having count(*) = 3
   );

  if v_missing is not null then
    raise exception 'the scholarship programme is incomplete: % has no active promotion with its three effects', v_missing;
  end if;
end $$;
