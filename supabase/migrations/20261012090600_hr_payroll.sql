-- ===========================================================================
-- HR pay: salaries, pay items, bank details, tax tables, timesheets, payroll
-- runs and payslips.
--
-- Everything here that shows what a person earns is guarded by
-- `hr_has_strict()`, which ignores `admin`: the admissions super
-- administrator does not read salaries unless they also hold a pay role.
--
-- Tax tables are data. They are seeded as drafts from the best published
-- figures, and the payroll engine refuses a draft: a payroll officer checks
-- each against the BURS or SARS publication and publishes it, after which it
-- is frozen. A rule change is a new tax year, never an edit.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Pay items
-- ---------------------------------------------------------------------------

create table if not exists public.hr_pay_items (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]*$'),
  label text not null,
  kind text not null check (kind in ('earning', 'allowance', 'deduction', 'employer_contribution')),
  taxable boolean not null default true,
  pre_tax boolean not null default false,
  -- Null: both countries.
  country text check (country in ('BW', 'ZA')),
  is_active boolean not null default true,
  sort_order int not null default 0
);

insert into public.hr_pay_items (code, label, kind, taxable, pre_tax, country, sort_order) values
  ('HOUSING', 'Housing allowance', 'allowance', true, false, null, 10),
  ('TRANSPORT', 'Transport allowance', 'allowance', true, false, null, 20),
  ('RESPONSIBILITY', 'Responsibility allowance', 'allowance', true, false, null, 30),
  ('BONUS', 'Bonus', 'earning', true, false, null, 40),
  ('REIMBURSEMENT', 'Reimbursement (not taxed)', 'allowance', false, false, null, 50),
  ('PENSION', 'Pension or retirement fund', 'deduction', false, true, null, 100),
  ('MEDICAL', 'Medical aid (employee share)', 'deduction', false, false, null, 110),
  ('LOAN', 'Staff loan repayment', 'deduction', false, false, null, 120),
  ('FEES', 'School fees (staff child)', 'deduction', false, false, null, 130),
  ('PENSION_ER', 'Pension (employer share)', 'employer_contribution', false, false, null, 200),
  ('MEDICAL_ER', 'Medical aid (employer share)', 'employer_contribution', false, false, null, 210)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- What each employee is paid
-- ---------------------------------------------------------------------------

-- Effective-dated: a raise is a new row from its date, so a re-run of an old
-- month pays what was due then.
create table if not exists public.hr_employee_compensation (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  effective_from date not null,
  pay_basis text not null default 'monthly' check (pay_basis in ('monthly', 'hourly')),
  basic_monthly_minor bigint not null default 0 check (basic_monthly_minor >= 0),
  hourly_rate_minor bigint not null default 0 check (hourly_rate_minor >= 0),
  normal_hours_per_month numeric(6,2) not null default 173.33,
  currency text not null check (currency in ('BWP', 'ZAR')),
  tax_residency text not null default 'resident' check (tax_residency in ('resident', 'non_resident')),
  medical_aid_members int not null default 0 check (medical_aid_members between 0 and 20),
  notes text,
  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (employee_id, effective_from)
);

create table if not exists public.hr_employee_pay_items (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  item_code text not null references public.hr_pay_items(code) on delete restrict,
  amount_minor bigint not null check (amount_minor >= 0),
  effective_from date not null,
  effective_to date,
  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint hr_employee_pay_items_dates check (effective_to is null or effective_to >= effective_from)
);

create index if not exists hr_employee_pay_items_employee_idx on public.hr_employee_pay_items (employee_id, effective_from);

create table if not exists public.hr_employee_bank (
  employee_id uuid primary key references public.hr_employees(id) on delete cascade,
  bank_name text not null,
  branch_code text,
  account_name text not null,
  account_number text not null,
  verified_by uuid references public.staff_profiles(id) on delete set null,
  verified_at timestamptz,
  updated_at timestamptz not null default now()
);

drop trigger if exists hr_employee_bank_set_updated_at on public.hr_employee_bank;
create trigger hr_employee_bank_set_updated_at
  before update on public.hr_employee_bank
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Tax tables
-- ---------------------------------------------------------------------------

create table if not exists public.hr_tax_years (
  id uuid primary key default gen_random_uuid(),
  country text not null check (country in ('BW', 'ZA')),
  code text not null unique,
  starts_on date not null,
  ends_on date not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  parameters jsonb not null default '{}'::jsonb,
  source_note text,
  published_by uuid references public.staff_profiles(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  constraint hr_tax_years_dates check (ends_on > starts_on)
);

create table if not exists public.hr_tax_brackets (
  id uuid primary key default gen_random_uuid(),
  tax_year_id uuid not null references public.hr_tax_years(id) on delete cascade,
  residency text not null check (residency in ('resident', 'non_resident')),
  lower_minor bigint not null check (lower_minor >= 0),
  upper_minor bigint,
  base_tax_minor bigint not null check (base_tax_minor >= 0),
  rate numeric(6,4) not null check (rate >= 0 and rate < 1),
  unique (tax_year_id, residency, lower_minor)
);

-- A published year is frozen: tax already calculated against it must be
-- reproducible from the same figures.
create or replace function public.hr_tax_year_frozen()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if tg_table_name = 'hr_tax_years' then
    if old.status = 'published' and (
         new.parameters is distinct from old.parameters
      or new.starts_on is distinct from old.starts_on
      or new.ends_on is distinct from old.ends_on
      or new.country is distinct from old.country
      or new.status not in ('published', 'retired')
    ) then
      raise exception 'tax_year_frozen' using hint = 'A published tax year cannot change. Add a new one.';
    end if;
    if old.status = 'retired' and new.status <> 'retired' then
      raise exception 'tax_year_frozen';
    end if;
    return new;
  end if;
  select status into v_status from public.hr_tax_years where id = coalesce(new.tax_year_id, old.tax_year_id);
  if v_status is distinct from 'draft' then
    raise exception 'tax_year_frozen' using hint = 'Brackets of a published tax year cannot change.';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.hr_tax_year_frozen() from public, anon, authenticated;

drop trigger if exists hr_tax_years_frozen on public.hr_tax_years;
create trigger hr_tax_years_frozen
  before update on public.hr_tax_years
  for each row execute function public.hr_tax_year_frozen();

drop trigger if exists hr_tax_brackets_frozen on public.hr_tax_brackets;
create trigger hr_tax_brackets_frozen
  before insert or update or delete on public.hr_tax_brackets
  for each row execute function public.hr_tax_year_frozen();

-- The seeds. Drafts, deliberately: see the note on each.
do $$
declare
  v_za uuid;
  v_bw uuid;
begin
  insert into public.hr_tax_years (country, code, starts_on, ends_on, parameters, source_note)
  values (
    'ZA', 'ZA-2027', '2026-03-01', '2027-02-28',
    jsonb_build_object(
      'rebates', jsonb_build_object('primary', 1782000, 'secondary', 976500, 'tertiary', 324900),
      'medicalCredits', jsonb_build_object('main', 36400, 'firstDependant', 36400, 'additional', 24600),
      'uif', jsonb_build_object('employeeRate', 0.01, 'employerRate', 0.01, 'monthlyCeilingMinor', 1771200),
      'sdl', jsonb_build_object('rate', 0.01, 'annualPayrollThresholdMinor', 50000000),
      'retirement', jsonb_build_object('rate', 0.275, 'annualCapMinor', 35000000)
    ),
    'Brackets, rebates and thresholds from the 2026 Budget as reported for the 2027 year (threshold R99,000). '
    'Medical tax credits are the 2026 year''s figures (R364 / R364 / R246) and must be checked against the 2027 SARS table before publishing. '
    'Check every figure against the SARS PAYE tables (Guide for Employers) before publishing.'
  )
  on conflict (code) do nothing
  returning id into v_za;

  if v_za is not null then
    insert into public.hr_tax_brackets (tax_year_id, residency, lower_minor, upper_minor, base_tax_minor, rate)
    select v_za, r.residency, b.lower_minor, b.upper_minor, b.base_tax_minor, b.rate
      from (values ('resident'), ('non_resident')) r(residency)
      cross join (values
        (0::bigint, 24510000::bigint, 0::bigint, 0.18),
        (24510000, 38310000, 4411800, 0.26),
        (38310000, 53020000, 7999800, 0.31),
        (53020000, 69580000, 12559900, 0.36),
        (69580000, 88700000, 18521500, 0.39),
        (88700000, 187860000, 25978300, 0.41),
        (187860000, null, 66633900, 0.45)
      ) b(lower_minor, upper_minor, base_tax_minor, rate);
  end if;

  insert into public.hr_tax_years (country, code, starts_on, ends_on, parameters, source_note)
  values (
    'BW', 'BW-2026/27', '2026-07-01', '2027-06-30',
    jsonb_build_object('pensionCapRate', 0.15),
    'Bands as reported for the Income Tax Act, 2026, from 1 July 2026, including the new 27.5% band above P400,000. '
    'The non-resident bands are derived from the previous year''s with the same new top band. '
    'Check every figure against the BURS PAYE tax table effective 1 July 2026 before publishing.'
  )
  on conflict (code) do nothing
  returning id into v_bw;

  if v_bw is not null then
    insert into public.hr_tax_brackets (tax_year_id, residency, lower_minor, upper_minor, base_tax_minor, rate) values
      (v_bw, 'resident', 0, 4800000, 0, 0),
      (v_bw, 'resident', 4800000, 8400000, 0, 0.05),
      (v_bw, 'resident', 8400000, 12000000, 180000, 0.125),
      (v_bw, 'resident', 12000000, 15600000, 630000, 0.1875),
      (v_bw, 'resident', 15600000, 40000000, 1305000, 0.25),
      (v_bw, 'resident', 40000000, null, 7405000, 0.275),
      (v_bw, 'non_resident', 0, 8400000, 0, 0.05),
      (v_bw, 'non_resident', 8400000, 12000000, 420000, 0.125),
      (v_bw, 'non_resident', 12000000, 15600000, 870000, 0.1875),
      (v_bw, 'non_resident', 15600000, 40000000, 1545000, 0.25),
      (v_bw, 'non_resident', 40000000, null, 7645000, 0.275);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Timesheets
-- ---------------------------------------------------------------------------

create table if not exists public.hr_timesheet_periods (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid not null references public.campuses(id) on delete restrict,
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status text not null default 'open' check (status in ('open', 'approved')),
  approved_by uuid references public.staff_profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campus_id, period)
);

create table if not exists public.hr_timesheet_entries (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.hr_timesheet_periods(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  days_worked numeric(5,2) not null default 0 check (days_worked >= 0 and days_worked <= 31),
  normal_hours numeric(6,2) not null default 0 check (normal_hours >= 0),
  overtime_hours numeric(6,2) not null default 0 check (overtime_hours >= 0),
  sunday_hours numeric(6,2) not null default 0 check (sunday_hours >= 0),
  public_holiday_hours numeric(6,2) not null default 0 check (public_holiday_hours >= 0),
  unpaid_days numeric(5,2) not null default 0 check (unpaid_days >= 0 and unpaid_days <= 31),
  notes text,
  updated_by uuid references public.staff_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (period_id, employee_id)
);

-- ---------------------------------------------------------------------------
-- Payroll runs and payslips
-- ---------------------------------------------------------------------------

create table if not exists public.hr_payroll_runs (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid not null references public.campuses(id) on delete restrict,
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  country text not null check (country in ('BW', 'ZA')),
  currency text not null check (currency in ('BWP', 'ZAR')),
  tax_year_id uuid references public.hr_tax_years(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'calculated', 'approved', 'locked')),
  totals jsonb not null default '{}'::jsonb,
  prepared_by uuid references public.staff_profiles(id) on delete set null,
  prepared_at timestamptz,
  approved_by uuid references public.staff_profiles(id) on delete set null,
  approved_at timestamptz,
  locked_by uuid references public.staff_profiles(id) on delete set null,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campus_id, period),
  -- Four eyes: the person who calculated a run cannot approve it.
  constraint hr_payroll_runs_four_eyes check (approved_by is null or prepared_by is null or approved_by <> prepared_by)
);

create table if not exists public.hr_payslips (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.hr_payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete restrict,
  -- Name, number, position and the last four digits of the account, as they
  -- were when the run was calculated: a payslip reprinted next year must say
  -- what it said.
  employee_snapshot jsonb not null,
  gross_minor bigint not null,
  taxable_minor bigint not null,
  paye_minor bigint not null,
  uif_employee_minor bigint not null default 0,
  uif_employer_minor bigint not null default 0,
  sdl_minor bigint not null default 0,
  deductions_minor bigint not null,
  net_minor bigint not null,
  employer_cost_minor bigint not null,
  calc_version text not null,
  inputs jsonb not null,
  warnings text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  unique (run_id, employee_id)
);

create table if not exists public.hr_payslip_lines (
  id uuid primary key default gen_random_uuid(),
  payslip_id uuid not null references public.hr_payslips(id) on delete cascade,
  code text not null,
  label text not null,
  kind text not null check (kind in ('earning', 'deduction', 'tax', 'employer')),
  computed_minor bigint not null,
  effective_minor bigint not null,
  override_reason text,
  overridden_by uuid references public.staff_profiles(id) on delete set null,
  sort_order int not null default 0
);

create index if not exists hr_payslip_lines_payslip_idx on public.hr_payslip_lines (payslip_id, sort_order);

-- A line override survives a recalculation of the run, as the person's
-- instruction for that employee and month.
create table if not exists public.hr_payslip_overrides (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.hr_payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  code text not null,
  amount_minor bigint not null,
  reason text not null check (length(reason) between 3 and 500),
  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (run_id, employee_id, code)
);

-- Once approved, a run's payslips, lines and overrides cannot change.
create or replace function public.hr_payroll_frozen()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_run uuid;
begin
  if tg_table_name = 'hr_payslip_lines' then
    select run_id into v_run from public.hr_payslips where id = coalesce(new.payslip_id, old.payslip_id);
  else
    v_run := coalesce(new.run_id, old.run_id);
  end if;
  select status into v_status from public.hr_payroll_runs where id = v_run;
  if v_status in ('approved', 'locked') then
    raise exception 'payroll_run_frozen' using hint = 'An approved run cannot change. Correct it in next month''s run.';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.hr_payroll_frozen() from public, anon, authenticated;

drop trigger if exists hr_payslips_frozen on public.hr_payslips;
create trigger hr_payslips_frozen
  before insert or update or delete on public.hr_payslips
  for each row execute function public.hr_payroll_frozen();

drop trigger if exists hr_payslip_lines_frozen on public.hr_payslip_lines;
create trigger hr_payslip_lines_frozen
  before insert or update or delete on public.hr_payslip_lines
  for each row execute function public.hr_payroll_frozen();

drop trigger if exists hr_payslip_overrides_frozen on public.hr_payslip_overrides;
create trigger hr_payslip_overrides_frozen
  before insert or update or delete on public.hr_payslip_overrides
  for each row execute function public.hr_payroll_frozen();

-- A run moves forward only, and a locked run never moves again.
create or replace function public.hr_payroll_run_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status = 'locked' then
    raise exception 'payroll_run_locked';
  end if;
  if old.status = 'approved' and new.status not in ('approved', 'locked') then
    raise exception 'payroll_run_frozen';
  end if;
  return new;
end;
$$;

revoke all on function public.hr_payroll_run_transition() from public, anon, authenticated;

drop trigger if exists hr_payroll_runs_transition on public.hr_payroll_runs;
create trigger hr_payroll_runs_transition
  before update on public.hr_payroll_runs
  for each row execute function public.hr_payroll_run_transition();

-- Payslip links for employees.
alter table public.hr_access_tokens
  drop constraint if exists hr_access_tokens_hr_payslip_id_fkey;
alter table public.hr_access_tokens
  add constraint hr_access_tokens_hr_payslip_id_fkey foreign key (hr_payslip_id) references public.hr_payslips(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- RLS: strict for anything showing pay.
-- ---------------------------------------------------------------------------

alter table public.hr_pay_items enable row level security;
alter table public.hr_employee_compensation enable row level security;
alter table public.hr_employee_pay_items enable row level security;
alter table public.hr_employee_bank enable row level security;
alter table public.hr_tax_years enable row level security;
alter table public.hr_tax_brackets enable row level security;
alter table public.hr_timesheet_periods enable row level security;
alter table public.hr_timesheet_entries enable row level security;
alter table public.hr_payroll_runs enable row level security;
alter table public.hr_payslips enable row level security;
alter table public.hr_payslip_lines enable row level security;
alter table public.hr_payslip_overrides enable row level security;

create or replace function public.hr_can_read_pay(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.hr_has_strict('hr.compensation.read')
     and exists (
       select 1 from public.hr_employees e
        where e.id = p_employee_id
          and public.can_access_campus(e.campus_id)
     )
$$;

revoke execute on function public.hr_can_read_pay(uuid) from public, anon;
grant execute on function public.hr_can_read_pay(uuid) to authenticated;

drop policy if exists hr_pay_items_select on public.hr_pay_items;
create policy hr_pay_items_select on public.hr_pay_items
  for select using ((select public.hr_is_hr_staff()));

drop policy if exists hr_employee_compensation_select on public.hr_employee_compensation;
create policy hr_employee_compensation_select on public.hr_employee_compensation
  for select using (public.hr_can_read_pay(employee_id));

drop policy if exists hr_employee_pay_items_select on public.hr_employee_pay_items;
create policy hr_employee_pay_items_select on public.hr_employee_pay_items
  for select using (public.hr_can_read_pay(employee_id));

drop policy if exists hr_employee_bank_select on public.hr_employee_bank;
create policy hr_employee_bank_select on public.hr_employee_bank
  for select using (public.hr_can_read_pay(employee_id));

drop policy if exists hr_tax_years_select on public.hr_tax_years;
create policy hr_tax_years_select on public.hr_tax_years
  for select using ((select public.hr_is_hr_staff()));

drop policy if exists hr_tax_brackets_select on public.hr_tax_brackets;
create policy hr_tax_brackets_select on public.hr_tax_brackets
  for select using ((select public.hr_is_hr_staff()));

-- Hours are not pay: whoever captures timesheets may read them.
drop policy if exists hr_timesheet_periods_select on public.hr_timesheet_periods;
create policy hr_timesheet_periods_select on public.hr_timesheet_periods
  for select using (
    ((select public.has_permission('hr.timesheets.write')) or (select public.hr_has_strict('hr.payroll.read')))
    and public.can_access_campus(campus_id)
  );

drop policy if exists hr_timesheet_entries_select on public.hr_timesheet_entries;
create policy hr_timesheet_entries_select on public.hr_timesheet_entries
  for select using (
    exists (
      select 1 from public.hr_timesheet_periods p
       where p.id = hr_timesheet_entries.period_id
         and ((select public.has_permission('hr.timesheets.write')) or (select public.hr_has_strict('hr.payroll.read')))
         and public.can_access_campus(p.campus_id)
    )
  );

drop policy if exists hr_payroll_runs_select on public.hr_payroll_runs;
create policy hr_payroll_runs_select on public.hr_payroll_runs
  for select using ((select public.hr_has_strict('hr.payroll.read')) and public.can_access_campus(campus_id));

drop policy if exists hr_payslips_select on public.hr_payslips;
create policy hr_payslips_select on public.hr_payslips
  for select using (
    exists (
      select 1 from public.hr_payroll_runs r
       where r.id = hr_payslips.run_id
         and (select public.hr_has_strict('hr.payroll.read'))
         and public.can_access_campus(r.campus_id)
    )
  );

drop policy if exists hr_payslip_lines_select on public.hr_payslip_lines;
create policy hr_payslip_lines_select on public.hr_payslip_lines
  for select using (
    exists (
      select 1 from public.hr_payslips s
        join public.hr_payroll_runs r on r.id = s.run_id
       where s.id = hr_payslip_lines.payslip_id
         and (select public.hr_has_strict('hr.payroll.read'))
         and public.can_access_campus(r.campus_id)
    )
  );

drop policy if exists hr_payslip_overrides_select on public.hr_payslip_overrides;
create policy hr_payslip_overrides_select on public.hr_payslip_overrides
  for select using (
    exists (
      select 1 from public.hr_payroll_runs r
       where r.id = hr_payslip_overrides.run_id
         and (select public.hr_has_strict('hr.payroll.read'))
         and public.can_access_campus(r.campus_id)
    )
  );
