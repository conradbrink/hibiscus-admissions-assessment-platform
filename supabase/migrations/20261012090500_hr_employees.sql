-- ===========================================================================
-- HR employees: the people who work at the schools.
--
-- An employee record is created when an applicant is hired (it keeps a link
-- to the application) or typed in by HR for someone who joined before the
-- system. It is not a login: a teacher may or may not also have a staff
-- account, and `staff_profile_id` links the two when they do.
--
-- Like recruitment, staff read through these policies and write through the
-- HR app's server actions under the service role, after the permission and
-- campus are checked and with an audit row.
-- ===========================================================================

create table if not exists public.hr_departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

insert into public.hr_departments (name) values
  ('Pre-school'), ('Primary'), ('Secondary'), ('Administration'), ('Finance'), ('Facilities'), ('Kitchen')
on conflict (name) do nothing;

create sequence if not exists public.hr_employee_number_seq;

create table if not exists public.hr_employees (
  id uuid primary key default gen_random_uuid(),
  employee_number text not null unique,
  campus_id uuid not null references public.campuses(id) on delete restrict,
  staff_profile_id uuid unique references public.staff_profiles(id) on delete set null,
  hr_application_id uuid unique references public.hr_applications(id) on delete set null,
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  position_title text not null,
  department_id uuid references public.hr_departments(id) on delete set null,
  manager_id uuid references public.hr_employees(id) on delete set null,
  is_teaching boolean not null default true,
  employment_status text not null default 'active'
    check (employment_status in ('active', 'on_leave', 'suspended', 'terminated')),
  employment_type text not null default 'permanent'
    check (employment_type in ('permanent', 'fixed_term', 'part_time', 'temporary')),
  start_date date not null,
  probation_end_date date,
  end_date date,
  termination_reason text,
  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_employees_manager_not_self check (manager_id is null or manager_id <> id),
  constraint hr_employees_dates check (end_date is null or end_date >= start_date)
);

create index if not exists hr_employees_campus_idx on public.hr_employees (campus_id, employment_status);

drop trigger if exists hr_employees_set_updated_at on public.hr_employees;
create trigger hr_employees_set_updated_at
  before update on public.hr_employees
  for each row execute function public.set_updated_at();

create or replace function public.hr_employees_set_number()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.employee_number is null or new.employee_number = '' then
    new.employee_number := 'HIS-' || lpad(nextval('public.hr_employee_number_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

revoke all on function public.hr_employees_set_number() from public, anon, authenticated;

drop trigger if exists hr_employees_number on public.hr_employees;
create trigger hr_employees_number
  before insert on public.hr_employees
  for each row execute function public.hr_employees_set_number();

-- Identity and personal details, read only with the sensitive permission.
create table if not exists public.hr_employee_private (
  employee_id uuid primary key references public.hr_employees(id) on delete cascade,
  id_number text,
  passport_number text,
  date_of_birth date,
  nationality text,
  address text,
  next_of_kin_name text,
  next_of_kin_phone text,
  tax_number text,
  registration_body text check (registration_body in ('SACE', 'BTPC', 'other', 'none')),
  registration_number text,
  registration_expires_on date,
  permit_type text,
  permit_expires_on date,
  police_clearance_on date,
  updated_at timestamptz not null default now()
);

drop trigger if exists hr_employee_private_set_updated_at on public.hr_employee_private;
create trigger hr_employee_private_set_updated_at
  before update on public.hr_employee_private
  for each row execute function public.set_updated_at();

create table if not exists public.hr_employee_contracts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  contract_type text not null check (contract_type in ('permanent', 'fixed_term', 'part_time', 'temporary')),
  starts_on date not null,
  ends_on date,
  probation_months int check (probation_months between 0 and 12),
  hours_per_week numeric(5,2),
  notice_weeks int,
  notes text,
  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint hr_employee_contracts_dates check (ends_on is null or ends_on >= starts_on)
);

create index if not exists hr_employee_contracts_employee_idx on public.hr_employee_contracts (employee_id, starts_on desc);

create table if not exists public.hr_employee_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  category text not null check (category in ('contract', 'id', 'qualification', 'registration', 'permit', 'police_clearance', 'disciplinary', 'other')),
  file_name text not null,
  storage_path text not null unique,
  mime text not null check (mime in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text not null,
  expires_on date,
  uploaded_by uuid references public.staff_profiles(id) on delete set null,
  uploaded_at timestamptz not null default now()
);

create index if not exists hr_employee_documents_employee_idx on public.hr_employee_documents (employee_id);
create index if not exists hr_employee_documents_expiry_idx on public.hr_employee_documents (expires_on) where expires_on is not null;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.hr_departments enable row level security;
alter table public.hr_employees enable row level security;
alter table public.hr_employee_private enable row level security;
alter table public.hr_employee_contracts enable row level security;
alter table public.hr_employee_documents enable row level security;

create or replace function public.hr_can_read_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_permission('hr.employees.read')
     and exists (
       select 1 from public.hr_employees e
        where e.id = p_employee_id
          and public.can_access_campus(e.campus_id)
     )
$$;

revoke execute on function public.hr_can_read_employee(uuid) from public, anon;
grant execute on function public.hr_can_read_employee(uuid) to authenticated;

drop policy if exists hr_departments_select on public.hr_departments;
create policy hr_departments_select on public.hr_departments
  for select using ((select public.hr_is_hr_staff()));

drop policy if exists hr_employees_select on public.hr_employees;
create policy hr_employees_select on public.hr_employees
  for select using (
    (
      (select public.has_permission('hr.employees.read'))
      -- Payroll officers see the people they pay, whatever else they hold.
      or (select public.hr_has_strict('hr.payroll.read'))
    )
    and public.can_access_campus(campus_id)
  );

drop policy if exists hr_employee_private_select on public.hr_employee_private;
create policy hr_employee_private_select on public.hr_employee_private
  for select using (
    (select public.has_permission('hr.employees.sensitive.read'))
    and public.hr_can_read_employee(employee_id)
  );

drop policy if exists hr_employee_contracts_select on public.hr_employee_contracts;
create policy hr_employee_contracts_select on public.hr_employee_contracts
  for select using (public.hr_can_read_employee(employee_id));

drop policy if exists hr_employee_documents_select on public.hr_employee_documents;
create policy hr_employee_documents_select on public.hr_employee_documents
  for select using (
    public.hr_can_read_employee(employee_id)
    and (
      category in ('contract', 'qualification', 'other')
      or (select public.has_permission('hr.employees.sensitive.read'))
    )
    and (category <> 'disciplinary' or (select public.has_permission('hr.disciplinary.read')))
  );

-- Messages to employees (payslips, leave decisions) are read with the employee.
alter table public.hr_email_messages
  drop constraint if exists hr_email_messages_hr_employee_id_fkey;
alter table public.hr_email_messages
  add constraint hr_email_messages_hr_employee_id_fkey foreign key (hr_employee_id) references public.hr_employees(id) on delete set null;

drop policy if exists hr_email_messages_select on public.hr_email_messages;
create policy hr_email_messages_select on public.hr_email_messages
  for select using (
    (hr_application_id is not null and public.hr_can_read_application(hr_application_id))
    or (hr_employee_id is not null and public.hr_can_read_employee(hr_employee_id))
  );
