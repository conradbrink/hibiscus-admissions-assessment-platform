-- The 2027 Botswana public holidays.
--
-- `school_closures` stops at 2027-01-10 — the end-of-year holiday, whose label
-- still says "Term 1 2027 start date to confirm". From 11 January 2027 onward
-- **nothing is blocked**, and the scholarship intake is Term 1 2027, so the
-- session generator (lib/workflow/automation/sessions.ts, which skips any
-- covered date) would happily publish interview and assessment sittings on
-- Botswana public holidays and invite families to a locked school.
--
-- ---------------------------------------------------------------------------
-- Where these dates come from
-- ---------------------------------------------------------------------------
--
-- Derived from the statutory rules, not copied from a website: this
-- environment's network policy blocks the public-holiday sites, and a date
-- typed from memory is exactly the kind of thing that closes a day the school
-- is open.
--
--   * Good Friday, Easter Monday and Ascension follow from the computus.
--     Easter Sunday 2027 is 28 March, so Good Friday is the 26th, Easter
--     Monday the 29th, and Ascension (Easter + 39 days) is 6 May.
--   * President's Day is the third Monday of July and the day after:
--     19 and 20 July 2027.
--   * The rest are fixed: 1 May, 1 July, 30 September and 1 October,
--     25 and 26 December.
--   * A public holiday falling on a **Sunday** is observed on the Monday.
--     Boxing Day 2027 is a Sunday, so Monday 27 December is included.
--     Labour Day 2027 falls on a Saturday, which does not roll.
--
-- The rules were checked against the school's own 2026 rows before being
-- trusted, and agree on every date they share: Ascension 14 May 2026,
-- President's Day 20–21 July 2026, Botswana Day 30 September 2026, Good Friday
-- 3 April 2026 and Sir Seretse Khama Day 1 July 2026. Five independent
-- agreements is good evidence the rules are right; it is not the same as the
-- school confirming its own calendar, which is still outstanding.
--
-- ---------------------------------------------------------------------------
-- What this deliberately does NOT do
-- ---------------------------------------------------------------------------
--
-- It seeds the **statutory days only**. The school's term breaks and mid-term
-- breaks are not derivable from anything — they are a decision the school
-- makes and has not yet sent for 2027 — so they are left out rather than
-- guessed. Two consequences worth knowing:
--
--   * A sitting can still be published inside what turns out to be a term
--     holiday. That is a gap this migration does not close, and the 2027 term
--     calendar is the thing that closes it.
--   * The existing 2026-12-10 → 2027-01-10 row already covers New Year (1 and
--     2 January 2027), so it is not repeated here.
--
-- Some of these fall on a weekend, where the generator makes no sittings
-- anyway. They are seeded regardless: a public-holiday calendar with the
-- weekend ones missing is a calendar somebody later has to second-guess, and
-- the row costs nothing.

-- ---------------------------------------------------------------------------
-- The seed, and the proof that it worked
-- ---------------------------------------------------------------------------
--
-- One loop rather than an insert followed by a separate check, because the
-- list of dates is the thing that must not drift and writing it twice is how
-- it drifts. Each range is inserted and then immediately proved closed.
--
-- The guard matches the **whole range**, not just the start and the label. An
-- earlier version matched on `(campus_id, starts_on, label)` alone, which
-- meant a pre-existing "Botswana Day holidays" row ending on 30 September
-- would have suppressed the row ending on 1 October — and the old check,
-- which counted rows rather than days, would have passed anyway and left
-- 1 October bookable. Counting rows proves nothing; the invariant is that
-- every day in every range is closed, so that is what is checked, day by day,
-- naming the first date that is not.
--
-- Coverage is asked of school-wide closures only (`campus_id is null`). A
-- closure at one campus does not make a public holiday, and counting it would
-- report the school closed when only Broadhurst was.
do $$
declare
  r record;
  v_uncovered date;
begin
  for r in
    select * from (values
      (date '2027-03-26', date '2027-03-29', 'Good Friday to Easter Monday'),
      (date '2027-05-01', date '2027-05-01', 'Labour Day (a Saturday in 2027)'),
      (date '2027-05-06', date '2027-05-06', 'Ascension Day'),
      (date '2027-07-01', date '2027-07-01', 'Sir Seretse Khama Day'),
      (date '2027-07-19', date '2027-07-20', 'Presidents'' Day and the day after'),
      (date '2027-09-30', date '2027-10-01', 'Botswana Day holidays'),
      (date '2027-12-25', date '2027-12-27', 'Christmas, Boxing Day and the Monday in lieu')
    ) as t(starts_on, ends_on, label)
  loop
    insert into public.school_closures (campus_id, starts_on, ends_on, label)
    select null, r.starts_on, r.ends_on, r.label
    where not exists (
      select 1 from public.school_closures x
       where x.campus_id is null
         and x.starts_on = r.starts_on
         and x.ends_on = r.ends_on
         and x.label = r.label
    );

    select d::date into v_uncovered
      from generate_series(r.starts_on, r.ends_on, interval '1 day') d
     where not exists (
       select 1 from public.school_closures x
        where x.campus_id is null and d::date between x.starts_on and x.ends_on
     )
     order by d
     limit 1;

    if v_uncovered is not null then
      raise exception '% is still open, though it falls inside "%"', v_uncovered, r.label;
    end if;
  end loop;

  raise notice '2027 public holidays: every day of all seven ranges is closed';
end $$;
