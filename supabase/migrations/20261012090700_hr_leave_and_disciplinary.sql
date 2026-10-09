-- ===========================================================================
-- HR leave and disciplinary.
--
-- Leave: types per country with a yearly entitlement, requests recorded by
-- HR on an employee's behalf, and a balance worked out from approved
-- requests. Disciplinary: a case per matter, with its record of events, the
-- hearing, the outcome, and any warning with the date it expires.
--
-- The default entitlements are a starting point and are editable: the
-- school's contracts, not this file, decide what each employee gets.
-- ===========================================================================

create table if not exists public.hr_leave_types (
  code text primary key check (code ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  -- Null: both countries.
  country text check (country in ('BW', 'ZA')),
  days_per_year numeric(5,1) not null default 0,
  paid boolean not null default true,
  needs_document boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0
);

insert into public.hr_leave_types (code, name, country, days_per_year, paid, needs_document, sort_order) values
  ('annual', 'Annual leave', null, 15, true, false, 10),
  ('sick', 'Sick leave', null, 10, true, true, 20),
  ('family', 'Family responsibility leave', 'ZA', 3, true, true, 30),
  ('compassionate', 'Compassionate leave', 'BW', 3, true, false, 35),
  ('maternity', 'Maternity leave', null, 0, false, true, 40),
  ('paternity', 'Parental leave', null, 0, false, true, 45),
  ('study', 'Study leave', null, 0, true, false, 50),
  ('unpaid', 'Unpaid leave', null, 0, false, false, 60)
on conflict (code) do nothing;

-- An entitlement different from the default, for one employee and year.
create table if not exists public.hr_leave_entitlements (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  leave_type_code text not null references public.hr_leave_types(code) on delete restrict,
  year int not null check (year between 2000 and 2100),
  days numeric(5,1) not null check (days >= 0),
  note text,
  unique (employee_id, leave_type_code, year)
);

create table if not exists public.hr_leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  leave_type_code text not null references public.hr_leave_types(code) on delete restrict,
  starts_on date not null,
  ends_on date not null,
  days numeric(5,1) not null check (days > 0),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'cancelled')),
  decided_by uuid references public.staff_profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint hr_leave_requests_dates check (ends_on >= starts_on)
);

create index if not exists hr_leave_requests_employee_idx on public.hr_leave_requests (employee_id, starts_on desc);
create index if not exists hr_leave_requests_pending_idx on public.hr_leave_requests (status) where status = 'pending';

create table if not exists public.hr_disciplinary_cases (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees(id) on delete restrict,
  category text not null check (category in ('misconduct', 'poor_performance', 'absence', 'safeguarding', 'grievance', 'other')),
  summary text not null check (length(summary) between 3 and 300),
  details text,
  status text not null default 'open' check (status in ('open', 'hearing_scheduled', 'outcome_given', 'appealed', 'closed')),
  outcome text check (outcome in ('no_action', 'verbal_warning', 'written_warning', 'final_written_warning', 'dismissal', 'other')),
  outcome_note text,
  opened_by uuid references public.staff_profiles(id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists hr_disciplinary_cases_employee_idx on public.hr_disciplinary_cases (employee_id, opened_at desc);

-- The case record: notes, evidence, the hearing, the outcome, an appeal, in
-- order. Append-only, like any record that may be read by a tribunal.
create table if not exists public.hr_case_events (
  id bigint generated always as identity primary key,
  case_id uuid not null references public.hr_disciplinary_cases(id) on delete cascade,
  kind text not null check (kind in ('note', 'evidence', 'hearing_scheduled', 'hearing_held', 'outcome', 'appeal', 'closed')),
  body text not null,
  occurs_at timestamptz,
  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists hr_case_events_case_idx on public.hr_case_events (case_id, id);

-- Even the service role cannot rewrite the record: a correction is a new note.
create or replace function public.hr_case_events_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'case_record_append_only' using hint = 'Add a note instead of changing the record.';
end;
$$;

revoke all on function public.hr_case_events_append_only() from public, anon, authenticated;

drop trigger if exists hr_case_events_append_only on public.hr_case_events;
create trigger hr_case_events_append_only
  before update on public.hr_case_events
  for each row execute function public.hr_case_events_append_only();

create table if not exists public.hr_warnings (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  case_id uuid references public.hr_disciplinary_cases(id) on delete set null,
  level text not null check (level in ('verbal', 'written', 'final_written')),
  issued_on date not null,
  expires_on date not null,
  reason text not null,
  acknowledged_at timestamptz,
  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint hr_warnings_dates check (expires_on > issued_on)
);

create index if not exists hr_warnings_employee_idx on public.hr_warnings (employee_id, expires_on desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.hr_leave_types enable row level security;
alter table public.hr_leave_entitlements enable row level security;
alter table public.hr_leave_requests enable row level security;
alter table public.hr_disciplinary_cases enable row level security;
alter table public.hr_case_events enable row level security;
alter table public.hr_warnings enable row level security;

drop policy if exists hr_leave_types_select on public.hr_leave_types;
create policy hr_leave_types_select on public.hr_leave_types
  for select using ((select public.hr_is_hr_staff()));

drop policy if exists hr_leave_entitlements_select on public.hr_leave_entitlements;
create policy hr_leave_entitlements_select on public.hr_leave_entitlements
  for select using (public.hr_can_read_employee(employee_id) or ((select public.has_permission('hr.leave.approve')) and exists (select 1 from public.hr_employees e where e.id = employee_id and public.can_access_campus(e.campus_id))));

drop policy if exists hr_leave_requests_select on public.hr_leave_requests;
create policy hr_leave_requests_select on public.hr_leave_requests
  for select using (public.hr_can_read_employee(employee_id) or ((select public.has_permission('hr.leave.approve')) and exists (select 1 from public.hr_employees e where e.id = employee_id and public.can_access_campus(e.campus_id))));

create or replace function public.hr_can_read_case(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_permission('hr.disciplinary.read')
     and exists (
       select 1 from public.hr_employees e
        where e.id = p_employee_id
          and public.can_access_campus(e.campus_id)
     )
$$;

revoke execute on function public.hr_can_read_case(uuid) from public, anon;
grant execute on function public.hr_can_read_case(uuid) to authenticated;

drop policy if exists hr_disciplinary_cases_select on public.hr_disciplinary_cases;
create policy hr_disciplinary_cases_select on public.hr_disciplinary_cases
  for select using (public.hr_can_read_case(employee_id));

drop policy if exists hr_case_events_select on public.hr_case_events;
create policy hr_case_events_select on public.hr_case_events
  for select using (
    exists (select 1 from public.hr_disciplinary_cases c where c.id = hr_case_events.case_id and public.hr_can_read_case(c.employee_id))
  );

drop policy if exists hr_warnings_select on public.hr_warnings;
create policy hr_warnings_select on public.hr_warnings
  for select using (public.hr_can_read_case(employee_id));

-- ---------------------------------------------------------------------------
-- Employee emails
-- ---------------------------------------------------------------------------

insert into public.hr_email_templates (key, audience, name, description, subject, body_text, body_html, allowed_variables)
values
(
  'hr_payslip_ready', 'employee',
  'Payslip ready',
  'Sent to each employee when a payroll run is approved and HR chooses to email payslips.',
  'Your payslip for {{period}}',
  E'Dear {{employee_first_name}},\n\nYour payslip for {{period}} is ready.\n\nOpen it with this link. The link works until {{link_expires_on}}.\n{{link}}\n\nIf something looks wrong, please reply to this email.\n\nKind regards,\nHuman Resources\nHibiscus International Schools',
  '<p>Dear {{employee_first_name}},</p><p>Your payslip for <strong>{{period}}</strong> is ready.</p><p><a href="{{link}}" class="button">Open my payslip</a></p><p>The link works until {{link_expires_on}}.</p><p>If something looks wrong, please reply to this email.</p><p>Kind regards,<br>Human Resources<br>Hibiscus International Schools</p>',
  array['employee_first_name', 'period', 'link', 'link_expires_on']
),
(
  'hr_leave_decision', 'employee',
  'Leave decision',
  'Sent to the employee when HR approves or declines a leave request, if they have an email address.',
  'Your {{leave_type}}: {{decision}}',
  E'Dear {{employee_first_name}},\n\nYour request for {{leave_type}} from {{starts_on}} to {{ends_on}} ({{days}} days) is {{decision}}.\n\n{{#if note}}{{note}}\n\n{{/if}}Kind regards,\nHuman Resources\nHibiscus International Schools',
  '<p>Dear {{employee_first_name}},</p><p>Your request for <strong>{{leave_type}}</strong> from {{starts_on}} to {{ends_on}} ({{days}} days) is <strong>{{decision}}</strong>.</p>{{#if note}}<p>{{note}}</p>{{/if}}<p>Kind regards,<br>Human Resources<br>Hibiscus International Schools</p>',
  array['employee_first_name', 'leave_type', 'starts_on', 'ends_on', 'days', 'decision', 'note']
)
on conflict (key, version) do nothing;
