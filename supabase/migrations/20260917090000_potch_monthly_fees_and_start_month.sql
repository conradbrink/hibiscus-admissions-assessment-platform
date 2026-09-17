-- Potchefstroom's fees, and the month a child starts.
--
-- Two things the school asked for on 17 September 2026, both about the three
-- campuses that take children in by the month rather than by the term: Potch
-- CBD, Potch South and Bana Tlokweng.
--
-- 1. Potch prices a half day and a full day per month, with lunch in the
--    price for the youngest classes and charged separately for Grade RR and
--    Grade R. Until now a Potch schedule carried one monthly figure with
--    "lunch included" in its label, so the letter could not quote the day a
--    family chose — the same gap the term campuses closed in
--    20260911240000_preschool_term_fees.sql, one level down.
--
-- 2. A family joining Potch or Tlokweng joins in a month, not a term. The
--    forms offered "Term 3, 2026" and the letter said "The term starts on…".
--    The campus now says which it runs by (`intake_cadence`), the application
--    carries the month (`start_month`), and the letter reads it. The term is
--    still recorded underneath: capacity, the academic year the fees belong
--    to and every report count by term, and lib/start-month.ts works the term
--    out from the month.

-- ---------------------------------------------------------------------------
-- 1. The vocabulary
-- ---------------------------------------------------------------------------

-- Three more codes, mirroring the term pair: one line per code, and a child is
-- placed on one of the two rates. `lib/fees/codes.test.ts` asserts the
-- TypeScript list and this one are the same set.
alter table public.fee_lines drop constraint if exists fee_lines_code_check;
alter table public.fee_lines add constraint fee_lines_code_check
  check (code in (
    'registration', 'admission',
    'tuition_annual', 'tuition_term', 'tuition_term_half', 'tuition_term_full',
    'tuition_month', 'tuition_month_half', 'tuition_month_full', 'lunch_month',
    'stationery_annual'
  ));

-- ---------------------------------------------------------------------------
-- 2. Potch CBD and Potch South: the rates
-- ---------------------------------------------------------------------------

-- Rand, in cents. Both sites, both years, every active schedule in the band.
-- The single monthly line and the eleven-month total go: the school quoted
-- neither, and two rates cannot share one annual figure. The R1,200
-- administration fee, payable to accept, is untouched.
--
-- Potch's schedules were created in the console rather than by a migration,
-- so a database rebuilt from migrations has none and these two statements
-- touch nothing there; the vocabulary above is what the replay proves.
delete from public.fee_lines l
 using public.fee_schedules s
  join public.campuses c on c.id = s.campus_id
 where l.schedule_id = s.id
   and c.code in ('potch', 'potch_south')
   and s.status = 'active'
   and l.code in ('tuition_month', 'tuition_annual');

insert into public.fee_lines (schedule_id, code, label, amount_minor, payable_at_acceptance, position)
select s.id, r.code, r.label, r.amount_minor, false, r.position
  from public.fee_schedules s
  join public.campuses c on c.id = s.campus_id
  join (values
    -- band low, band high, code, label, cents, position (lib/fees/codes.ts order)
    (1, 3, 'tuition_month_half', 'Tuition per month (half day, lunch included)', 268000, 4),
    (1, 3, 'tuition_month_full', 'Tuition per month (full day, lunch included)', 298000, 5),
    (4, 4, 'tuition_month_half', 'Tuition per month (half day)',                240000, 4),
    (4, 4, 'tuition_month_full', 'Tuition per month (full day)',                270000, 5),
    (4, 4, 'lunch_month',        'Lunch per month',                              50000, 6),
    (5, 5, 'tuition_month_half', 'Tuition per month (half day)',                255000, 4),
    (5, 5, 'tuition_month_full', 'Tuition per month (full day)',                285000, 5),
    (5, 5, 'lunch_month',        'Lunch per month',                              50000, 6)
  ) as r(gmin, gmax, code, label, amount_minor, position)
    on r.gmin = s.grade_sort_min and r.gmax = s.grade_sort_max
 where c.code in ('potch', 'potch_south')
   and s.status = 'active'
    on conflict (schedule_id, code) do update
       set amount_minor = excluded.amount_minor,
           label = excluded.label,
           payable_at_acceptance = false,
           position = excluded.position;

-- ---------------------------------------------------------------------------
-- 3. Which campuses run by the month
-- ---------------------------------------------------------------------------

alter table public.campuses
  add column if not exists intake_cadence text not null default 'term'
  check (intake_cadence in ('term', 'month'));

comment on column public.campuses.intake_cadence is
  'term: families join by the term and the letter names the term. month: families choose a month, are invoiced monthly, and the letter names the month; the term is still recorded on the application for counting.';

update public.campuses
   set intake_cadence = 'month', updated_at = now()
 where code in ('potch', 'potch_south', 'tlokweng')
   and intake_cadence <> 'month';

-- The console reads campuses through this view. It was created from `c.*`,
-- which froze the columns of the day, so it has never carried the contact
-- columns added since and would not carry this one. Recreated, it grows at
-- the end, which is the one way a replaced view is allowed to change shape.
create or replace view public.v_accessible_campuses
with (security_invoker = true)
as
select c.*
from public.campuses c
where c.is_active
  and public.can_access_campus(c.id);

-- ---------------------------------------------------------------------------
-- 4. The month on the application
-- ---------------------------------------------------------------------------

-- Always the first of the month, so two applications for "October 2026"
-- compare equal and a report can group on it. Null at a termly campus, and
-- on the monthly campuses' existing applications, where the term stands in
-- until somebody sets the month on the applicant page.
alter table public.applications
  add column if not exists start_month date
  check (start_month is null or start_month = date_trunc('month', start_month)::date);

comment on column public.applications.start_month is
  'The month the child starts, at a campus whose intake_cadence is month: the first of that month. Null elsewhere. The offer letter and the enrolment start date read this before the term.';

-- ---------------------------------------------------------------------------
-- 5. create_application takes the month
-- ---------------------------------------------------------------------------

-- One more trailing parameter with a default, so every existing call still
-- works. The old signature is dropped rather than overloaded: PostgREST calls
-- by name, and two matching functions is "function is not unique".
drop function if exists public.create_application(
  text, text, text, text, text, text, text, text, date, uuid, uuid, uuid, uuid, text, text, text, text, text, text, boolean
);

create or replace function public.create_application(
  p_parent_first_name text,
  p_parent_last_name text,
  p_email text,
  p_email_normalised text,
  p_mobile text,
  p_mobile_normalised text,
  p_child_first_name text,
  p_child_last_name text,
  p_child_date_of_birth date,
  p_campus_id uuid,
  p_grade_id uuid,
  p_recommended_grade_id uuid,
  p_intake_id uuid,
  p_entry_route text,
  p_source text default 'website',
  p_current_school text default null,
  p_current_grade text default null,
  p_heard_from text default null,
  p_heard_from_detail text default null,
  p_trusted boolean default false,
  p_start_month date default null
)
returns table (application_id uuid, reference text, contact_id uuid, created boolean)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_contact_id uuid;
  v_application_id uuid;
  v_reference text;
  v_requires boolean;
begin
  select c.id into v_contact_id from public.contacts c where c.email_normalised = p_email_normalised;

  if v_contact_id is null then
    insert into public.contacts (first_name, last_name, email, email_normalised, mobile, mobile_normalised)
    values (
      p_parent_first_name, p_parent_last_name, p_email, p_email_normalised,
      p_mobile, p_mobile_normalised
    )
    returning id into v_contact_id;
  elsif p_trusted then
    -- The family, or the desk: what was just typed is the better spelling and
    -- the newer number. A blank does not erase a number.
    update public.contacts
       set first_name = p_parent_first_name,
           last_name = p_parent_last_name,
           email = p_email,
           mobile = coalesce(p_mobile, mobile),
           mobile_normalised = coalesce(p_mobile_normalised, mobile_normalised)
     where id = v_contact_id;
  end if;
  -- Not trusted and already on file: the contact row is left exactly as it
  -- was. Nobody types over a stranger's name or phone number.

  -- Same parent, same child, same intake. `child_last_name` is deliberately
  -- not part of this: see 20260913100000_one_child_one_enquiry.sql.
  select a.id, a.reference into v_application_id, v_reference
    from public.applications a
   where a.contact_id = v_contact_id
     and lower(a.child_first_name) = lower(p_child_first_name)
     and a.child_date_of_birth = p_child_date_of_birth
     and a.intake_id = p_intake_id
     and a.status <> 'withdrawn'
   order by a.created_at
   limit 1;

  if v_application_id is not null then
    if p_trusted then
      update public.applications
         set child_first_name = coalesce(nullif(trim(p_child_first_name), ''), child_first_name),
             child_last_name  = coalesce(nullif(trim(p_child_last_name),  ''), child_last_name),
             -- The month is the family's to change while they are still
             -- enquiring; a re-enquiry naming a different month in the same
             -- term is the same enquiry with a corrected month.
             start_month      = coalesce(p_start_month, start_month),
             updated_at = now()
       where id = v_application_id;

      if p_heard_from is not null then
        update public.applications
           set heard_from = p_heard_from,
               heard_from_detail = nullif(p_heard_from_detail, '')
         where id = v_application_id and heard_from is null;
      end if;
    end if;
    return query select v_application_id, v_reference, v_contact_id, false;
    return;
  end if;

  select g.requires_assessment into v_requires from public.grades g where g.id = p_grade_id;
  if v_requires is null then
    raise exception 'grade_not_found';
  end if;

  v_reference := public.next_application_reference();

  insert into public.applications (
    reference, contact_id, child_first_name, child_last_name, child_date_of_birth,
    campus_id, grade_id, recommended_grade_id, intake_id, start_month, requires_assessment,
    entry_route, source, current_school, current_grade, heard_from, heard_from_detail
  ) values (
    v_reference, v_contact_id, p_child_first_name, p_child_last_name, p_child_date_of_birth,
    p_campus_id, p_grade_id, p_recommended_grade_id, p_intake_id, p_start_month, v_requires,
    p_entry_route, p_source, p_current_school, p_current_grade,
    p_heard_from, nullif(p_heard_from_detail, '')
  )
  returning id into v_application_id;

  insert into public.application_guardians (application_id, contact_id, relationship, is_primary)
  values (v_application_id, v_contact_id, 'parent', true);

  return query select v_application_id, v_reference, v_contact_id, true;
end;
$$;

revoke execute on function public.create_application(
  text, text, text, text, text, text, text, text, date, uuid, uuid, uuid, uuid, text, text, text, text, text, text, boolean, date
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The letter: version 9
-- ---------------------------------------------------------------------------

-- A new version, because a template is versioned and an offer already sent
-- keeps the version it was rendered with. Four changes to version 8:
--
--   a. The opening sentence. "The term starts on…" is right for a term and
--      wrong for a month, so it is guarded on `by_term`, and a monthly campus
--      gets its own sentence under `by_month`. The renderer resolves nested
--      {{#if}} blocks innermost-first (lib/email/render.ts).
--   b. Three fee rows: the two monthly rates and lunch, each printing only
--      when the schedule carries it, as the term rows already do.
--   c. The half-day/full-day paragraph, for a campus priced by the month.
--   d. "before the term begins" becomes "before {{student_first_name}}
--      starts", which is true either way.
--
-- One active template per key is enforced by an index, so the outgoing one
-- steps aside before the new one arrives.
update public.offer_templates set is_active = false, updated_at = now()
 where key = 'standard' and is_active
   and not exists (select 1 from public.offer_templates x where x.key = 'standard' and x.version = 9);

insert into public.offer_templates (key, version, name, body_html, terms_html, allowed_variables, is_active)
select
  'standard',
  9,
  t.name,
  replace(
    replace(
      replace(
        replace(
          t.body_html,
          'for <strong>{{intake}}</strong>. {{#if intake_not_started}}The term starts on {{start_date}}.{{/if}}{{#if intake_started}}The term started on {{start_date}}.{{/if}}</p>',
          'for <strong>{{intake}}</strong>. {{#if by_term}}{{#if intake_not_started}}The term starts on {{start_date}}.{{/if}}{{#if intake_started}}The term started on {{start_date}}.{{/if}}{{/if}}{{#if by_month}}{{campus}} takes children in by the month, and fees are invoiced monthly from {{intake}}.{{/if}}</p>'
        ),
        '{{#if tuition_month}}<tr><td>Tuition per month</td><td>{{tuition_month}}</td></tr>{{/if}}',
        '{{#if tuition_month}}<tr><td>Tuition per month (the school invoices this each month)</td><td>{{tuition_month}}</td></tr>{{/if}}{{#if tuition_month_half}}<tr><td>Tuition per month — half day (the school invoices this each month)</td><td>{{tuition_month_half}}</td></tr>{{/if}}{{#if tuition_month_full}}<tr><td>Tuition per month — full day (the school invoices this each month)</td><td>{{tuition_month_full}}</td></tr>{{/if}}{{#if lunch_month}}<tr><td>Lunch per month (the school invoices this each month)</td><td>{{lunch_month}}</td></tr>{{/if}}'
      ),
      'will tell you what is needed and what it costs before the term begins.',
      'will tell you what is needed and what it costs before {{student_first_name}} starts.'
    ),
    '{{#if tuition_term_half}}<p>Half day and full day are both available. Tell the school which suits you and we will confirm the term fee; nothing above needs to be paid to accept this offer.</p>{{/if}}',
    '{{#if tuition_term_half}}<p>Half day and full day are both available. Tell the school which suits you and we will confirm the term fee; nothing above needs to be paid to accept this offer.</p>{{/if}}{{#if tuition_month_half}}<p>Half day and full day are both available. Tell the school which suits you and we will confirm the monthly fee. The monthly fee is invoiced and is not part of the amount to pay now.</p>{{/if}}'
  ),
  t.terms_html,
  (select array(select distinct v from unnest(t.allowed_variables || array['by_term', 'by_month', 'tuition_month_half', 'tuition_month_full', 'lunch_month']) as v order by v)),
  true
from public.offer_templates t
where t.key = 'standard' and t.version = 8
  and not exists (select 1 from public.offer_templates x where x.key = 'standard' and x.version = 9);

update public.offer_templates set is_active = true, updated_at = now()
 where key = 'standard' and version = 9 and not is_active;

-- The replacements are exact strings, so a template someone has since edited
-- would silently copy forward unchanged. Fail loudly instead: a letter that
-- tells a Potch family "the term starts on" is the whole point.
do $$
declare
  v_body text;
begin
  select body_html into v_body from public.offer_templates where key = 'standard' and version = 9;
  if v_body is null then
    raise exception 'offer template v9 was not created';
  end if;
  if position('{{#if by_month}}' in v_body) = 0 or position('{{#if by_term}}' in v_body) = 0 then
    raise exception 'offer template v9 still words the start as a term for every campus';
  end if;
  if position('{{lunch_month}}' in v_body) = 0 or position('{{tuition_month_half}}' in v_body) = 0 then
    raise exception 'offer template v9 has no rows for the monthly rates';
  end if;
  if position('before {{student_first_name}} starts.' in v_body) = 0 then
    raise exception 'offer template v9 still says "before the term begins"';
  end if;
end $$;
