-- Pre-school tuition per term, half day and full day, from the school's own
-- published fee table (hibiscusschools.com/admissions#fees).
--
--   Phase 4, Sarona City, Block 7    Nursery–Kindergarten   P9,800 / P10,790
--                                    Pre-Reception–Reception P10,500 / P11,500
--   Phase 2, Village                 Nursery–Kindergarten   P8,700 / P9,400
--                                    Pre-Reception–Reception P9,800 / P10,790
--
-- Both 2026 and 2027, same amounts, on the school's instruction.
--
-- Bana Tlokweng is deliberately not here. The published table groups it with
-- Phase 2 and Village, but our schedules price it per *month* (P1,590 to
-- P1,950) and the school asked for those to be left alone. The two therefore
-- disagree in public; that is the school's to settle, not this migration's.
--
-- None of these are payable to secure a place: tuition is invoiced each term,
-- and what a family pays to accept stays the application and admission fees.

-- ---------------------------------------------------------------------------
-- The vocabulary the column will accept
-- ---------------------------------------------------------------------------

-- `fee_lines.code` is constrained to a list, last widened by
-- 20260910160000_bana_tlokweng.sql for stationery. Without this the inserts
-- below fail outright — and the local replay would not have caught it,
-- because the schedules these lines attach to were created at runtime and do
-- not exist in a database rebuilt from migrations. `lib/fees/codes.test.ts`
-- is what actually catches this: it asserts the TypeScript vocabulary and
-- this list are the same set.
alter table public.fee_lines drop constraint if exists fee_lines_code_check;
alter table public.fee_lines add constraint fee_lines_code_check
  check (code in (
    'registration', 'admission',
    'tuition_annual', 'tuition_term', 'tuition_term_half', 'tuition_term_full',
    'tuition_month', 'stationery_annual'
  ));

-- ---------------------------------------------------------------------------
-- Phase 2 has one schedule spanning Nursery to Reception, which cannot carry
-- two different rates. Split it, carrying its application fee onto both.
-- ---------------------------------------------------------------------------

do $$
declare
  v_schedule record;
  v_new uuid;
begin
  for v_schedule in
    select s.id, s.campus_id, s.academic_year_id, s.status, s.currency
      from public.fee_schedules s
      join public.campuses c on c.id = s.campus_id
     where c.name = 'Phase 2'
       and s.grade_sort_min = 10 and s.grade_sort_max = 50
  loop
    -- The existing row becomes the younger band.
    update public.fee_schedules
       set grade_sort_max = 30,
           name = 'Phase 2 · Nursery to Kindergarten · ' ||
                  (select label from public.academic_years where id = v_schedule.academic_year_id)
     where id = v_schedule.id;

    -- And a sibling covers the older one, with the same fees it had.
    insert into public.fee_schedules (campus_id, academic_year_id, name, grade_sort_min, grade_sort_max, status, currency)
    values (
      v_schedule.campus_id,
      v_schedule.academic_year_id,
      'Phase 2 · Pre-Reception to Reception · ' ||
        (select label from public.academic_years where id = v_schedule.academic_year_id),
      40, 50, v_schedule.status, v_schedule.currency
    )
    returning id into v_new;

    insert into public.fee_lines (schedule_id, code, label, amount_minor, payable_at_acceptance, position)
    select v_new, l.code, l.label, l.amount_minor, l.payable_at_acceptance, l.position
      from public.fee_lines l
     where l.schedule_id = v_schedule.id
        on conflict (schedule_id, code) do nothing;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Block 7's bands straddle the boundary: a draft covering Nursery to
-- Pre-Reception, and a live schedule for Reception alone. The rates split at
-- Pre-Reception, so the draft gives up Pre-Reception to the live one.
-- The draft stays a draft, on the school's instruction.
-- ---------------------------------------------------------------------------

update public.fee_schedules s
   set grade_sort_max = 30
  from public.campuses c
 where c.id = s.campus_id and c.name = 'Block 7'
   and s.grade_sort_min = 10 and s.grade_sort_max = 40;

update public.fee_schedules s
   set grade_sort_min = 40
  from public.campuses c
 where c.id = s.campus_id and c.name = 'Block 7'
   and s.grade_sort_min = 50 and s.grade_sort_max = 50;

-- ---------------------------------------------------------------------------
-- The rates
-- ---------------------------------------------------------------------------

insert into public.fee_lines (schedule_id, code, label, amount_minor, payable_at_acceptance, position)
select s.id, r.code, r.label, amt.amount_minor, false, r.position
  from public.fee_schedules s
  join public.campuses c on c.id = s.campus_id
  join public.academic_years ay on ay.id = s.academic_year_id
  join (values
    -- campus,        band low, band high, half (thebe),  full (thebe)
    ('Phase 4',     10, 30,  980000, 1079000),
    ('Sarona City', 10, 30,  980000, 1079000),
    ('Block 7',     10, 30,  980000, 1079000),
    ('Phase 4',     40, 50, 1050000, 1150000),
    ('Sarona City', 40, 50, 1050000, 1150000),
    ('Block 7',     40, 50, 1050000, 1150000),
    ('Phase 2',     10, 30,  870000,  940000),
    ('Village',     10, 30,  870000,  940000),
    ('Phase 2',     40, 50,  980000, 1079000),
    ('Village',     40, 50,  980000, 1079000)
  ) as f(campus, gmin, gmax, half_minor, full_minor)
    on f.campus = c.name and f.gmin = s.grade_sort_min and f.gmax = s.grade_sort_max
  join (values
    ('tuition_term_half', 'Tuition per term (half day)', 4),
    ('tuition_term_full', 'Tuition per term (full day)', 5)
  ) as r(code, label, position) on true
 cross join lateral (
   select case when r.code = 'tuition_term_half' then f.half_minor else f.full_minor end as amount_minor
 ) amt
 where ay.label in ('2026', '2027')
    on conflict (schedule_id, code) do update
       set amount_minor = excluded.amount_minor,
           label = excluded.label,
           payable_at_acceptance = false,
           position = excluded.position;
