-- Student export and the analytics facts view.
--
-- Ed-admin's API is not known, so the integration is a file: enrolled
-- students export as a CSV or JSON batch whose columns are configuration
-- (a path into the enrolment snapshot, a header, a transform), and each
-- record remembers which batch carried it. The StudentManagementSystem seam
-- stays for the day the API exists.
--
-- The analytics views gain one row-per-application facts view: the
-- milestones plus the names, the outcome, the money and the message counts
-- the breakdowns and the forecast read. security_invoker, like the rest.

-- ---------------------------------------------------------------------------
-- Export columns: what a row looks like
-- ---------------------------------------------------------------------------

create table if not exists public.export_columns (
  id uuid primary key default gen_random_uuid(),
  position int not null default 0,
  header text not null,
  -- A dotted path into the student record snapshot: student.legal_first_name,
  -- guardians[0].mobile, application.grade. Nothing outside the snapshot.
  source_path text not null check (source_path ~ '^[a-z_]+(\[[0-9]+\])?(\.[a-z_]+(\[[0-9]+\])?)*$'),
  transform text not null default 'none' check (transform in ('none', 'upper', 'date_dmy', 'date_ymd', 'yes_no', 'money')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists export_columns_set_updated_at on public.export_columns;
create trigger export_columns_set_updated_at
  before update on public.export_columns
  for each row execute function public.set_updated_at();

comment on table public.export_columns is
  'The columns of the student export, in order. Edited under Set up; the default leaves medical fields off.';

insert into public.export_columns (position, header, source_path, transform, is_active)
select * from (values
  (10,  'Reference',              'application.reference',                'none',     true),
  (20,  'Campus',                 'application.campus',                   'none',     true),
  (30,  'Campus code',            'application.campus_code',              'none',     true),
  (40,  'Grade',                  'application.grade',                    'none',     true),
  (50,  'Intake',                 'application.intake',                   'none',     true),
  (60,  'Start date',             'application.start_date',               'date_dmy', true),
  (100, 'Legal first name',       'student.legal_first_name',             'none',     true),
  (110, 'Middle names',           'student.legal_middle_names',           'none',     true),
  (120, 'Surname',                'student.legal_last_name',              'upper',    true),
  (130, 'Preferred name',         'student.preferred_name',               'none',     true),
  (140, 'Gender',                 'student.gender',                       'none',     true),
  (150, 'Date of birth',          'student.date_of_birth',                'date_dmy', true),
  (160, 'Nationality',            'student.nationality',                  'none',     true),
  (170, 'Country of birth',       'student.country_of_birth',             'none',     true),
  (180, 'Place of birth',         'student.place_of_birth',               'none',     true),
  (190, 'Home language',          'student.home_language',                'none',     true),
  (200, 'Identity type',          'student.identity_type',                'none',     true),
  (210, 'Identity number',        'student.identity_number',              'none',     true),
  (220, 'Previous institution',   'student.previous_institution',         'none',     true),
  (230, 'Previous grade',         'student.current_grade',                'none',     true),
  (300, 'Guardian 1 first name',  'guardians[0].first_name',              'none',     true),
  (310, 'Guardian 1 surname',     'guardians[0].last_name',               'none',     true),
  (320, 'Guardian 1 relationship','guardians[0].relationship',            'none',     true),
  (330, 'Guardian 1 email',       'guardians[0].email',                   'none',     true),
  (340, 'Guardian 1 mobile',      'guardians[0].mobile',                  'none',     true),
  (350, 'Guardian 1 phone',       'guardians[0].phone',                   'none',     true),
  (360, 'Guardian 1 address',     'guardians[0].address',                 'none',     true),
  (400, 'Guardian 2 first name',  'guardians[1].first_name',              'none',     true),
  (410, 'Guardian 2 surname',     'guardians[1].last_name',               'none',     true),
  (420, 'Guardian 2 relationship','guardians[1].relationship',            'none',     true),
  (430, 'Guardian 2 email',       'guardians[1].email',                   'none',     true),
  (440, 'Guardian 2 mobile',      'guardians[1].mobile',                  'none',     true),
  (500, 'Emergency 1 name',       'emergency_contacts[0].first_name',     'none',     true),
  (510, 'Emergency 1 surname',    'emergency_contacts[0].last_name',      'none',     true),
  (520, 'Emergency 1 phone',      'emergency_contacts[0].phone',          'none',     true),
  (530, 'Emergency 2 name',       'emergency_contacts[1].first_name',     'none',     true),
  (540, 'Emergency 2 phone',      'emergency_contacts[1].phone',          'none',     true),
  (600, 'Fees currency',          'payment.currency',                     'none',     true),
  (610, 'Fees paid on',           'payment.paid_at',                      'date_dmy', true),
  (620, 'Fees amount',            'payment.amount_minor',                 'money',    true),
  -- Medical is off by default: it leaves the system only when an administrator turns a column on.
  (700, 'Medical aid',            'medical.medical_aid_name',             'none',     false),
  (710, 'Medical aid number',     'medical.medical_aid_number',           'none',     false),
  (720, 'Emergency treatment consent', 'medical.emergency_treatment_consent', 'yes_no', false),
  (730, 'Allergies',              'medical.allergies',                    'none',     false),
  (740, 'Medical conditions',     'medical.medical_conditions',           'none',     false),
  (750, 'Medication',             'medical.medication',                   'none',     false)
) as v(position, header, source_path, transform, is_active)
where not exists (select 1 from public.export_columns);

-- ---------------------------------------------------------------------------
-- Export batches
-- ---------------------------------------------------------------------------

create table if not exists public.student_exports (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references public.campuses(id) on delete set null,
  intake_id uuid references public.intakes(id) on delete set null,
  format text not null check (format in ('csv', 'json')),
  record_count int not null default 0,
  filename text not null,
  -- The columns as they were, so a batch can be re-rendered the same way later.
  columns_snapshot jsonb not null default '[]'::jsonb,
  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists student_exports_created_idx on public.student_exports(created_at desc);

alter table public.student_records
  add column if not exists export_batch_id uuid references public.student_exports(id) on delete set null,
  add column if not exists export_count int not null default 0;

-- ---------------------------------------------------------------------------
-- Registration prefill counters, for the parent-effort metrics
-- ---------------------------------------------------------------------------

alter table public.registrations
  add column if not exists prefilled_count int not null default 0,
  add column if not exists prefill_changed_count int not null default 0;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.export_columns enable row level security;
alter table public.student_exports enable row level security;

drop policy if exists export_columns_select on public.export_columns;
create policy export_columns_select on public.export_columns
  for select using ((select public.current_staff_id()) is not null);
drop policy if exists export_columns_write on public.export_columns;
create policy export_columns_write on public.export_columns
  for all using ((select public.has_permission('settings.write')))
  with check ((select public.has_permission('settings.write')));

-- A batch is visible to whoever may export and may see its campus; a batch
-- with no campus (all campuses) is visible to whoever may see every campus.
drop policy if exists student_exports_select on public.student_exports;
create policy student_exports_select on public.student_exports
  for select using (
    (select public.has_permission('data.export'))
    and (campus_id is null or (select public.can_access_campus(campus_id)))
  );
-- Written by the export route through the service role after an RLS read.

-- ---------------------------------------------------------------------------
-- Facts view
-- ---------------------------------------------------------------------------

create or replace view public.v_application_facts
with (security_invoker = true)
as
select
  m.application_id,
  m.campus_id,
  c.name as campus_name,
  m.grade_id,
  g.name as grade_name,
  g.sort_order as grade_sort,
  m.intake_id,
  i.label as intake_label,
  i.starts_on as intake_starts_on,
  i.academic_year_id,
  m.entry_route,
  m.source,
  m.requires_assessment,
  m.status,
  m.enquired_at,
  m.booked_at,
  m.attended_at,
  m.no_show_at,
  m.assessed_at,
  m.decided_at,
  m.offered_at,
  m.accepted_at,
  m.paid_at,
  m.enrolled_at,
  (select min(ev.occurred_at) from public.application_events ev
     where ev.application_id = m.application_id and ev.type = 'application.withdrawn') as withdrawn_at,
  (select d.final_outcome from public.admission_decisions d
     where d.application_id = m.application_id and d.final_outcome <> 'staff_review'
     order by d.decided_at desc limit 1) as decision_outcome,
  (select o.status from public.offers o
     where o.application_id = m.application_id
     order by o.created_at desc limit 1) as offer_status,
  (select coalesce(sum(pr.paid_minor), 0) from public.payment_requests pr
     where pr.application_id = m.application_id)::bigint as paid_minor,
  (select count(*) from public.email_messages e
     where e.application_id = m.application_id and e.status <> 'failed')::int as emails_sent,
  (select count(*) from public.messages x
     where x.application_id = m.application_id and x.direction = 'out' and x.status in ('sent', 'delivered', 'read'))::int as messages_sent,
  (select count(*) from public.application_events ev
     where ev.application_id = m.application_id and ev.type = 'booking.no_show')::int as no_show_count,
  coalesce(r.prefilled_count, 0) as prefilled_count,
  coalesce(r.prefill_changed_count, 0) as prefill_changed_count,
  (r.submitted_at is not null) as registration_submitted
from public.v_application_milestones m
join public.campuses c on c.id = m.campus_id
join public.grades g on g.id = m.grade_id
join public.intakes i on i.id = m.intake_id
left join public.registrations r on r.application_id = m.application_id;

-- ---------------------------------------------------------------------------
-- Marking records exported: one statement, service role only
-- ---------------------------------------------------------------------------

create or replace function public.mark_student_records_exported(p_record_ids uuid[], p_batch_id uuid)
returns int
language sql
security definer
set search_path = public
as $$
  with updated as (
    update public.student_records
       set export_status = 'exported',
           exported_at = now(),
           export_batch_id = p_batch_id,
           export_count = export_count + 1,
           export_error = null
     where id = any(p_record_ids)
    returning id
  )
  select count(*)::int from updated;
$$;

revoke execute on function public.mark_student_records_exported(uuid[], uuid) from public, anon, authenticated;
