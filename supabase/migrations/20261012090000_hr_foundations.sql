-- ===========================================================================
-- HR foundations: permissions, roles, settings, the HR audit log and the HR
-- job queue.
--
-- The HR app (`hr/`) is a separate application on the same database. It
-- shares staff accounts, roles and campuses with admissions and nothing else:
-- every table it writes is prefixed `hr_`, and it has its own audit log, job
-- queue, email templates and magic-link tokens. The admissions drain claims
-- every row in `jobs` and fails any type it has no handler for, and
-- `audit_log` is readable by admissions auditors, so sharing either would be
-- a bug on the first day.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

insert into public.permissions (code, label, sort_order) values
  ('hr.recruitment.read',            'HR: view vacancies and applicants',                         500),
  ('hr.recruitment.write',           'HR: manage vacancies, notes, interviews and the pipeline',  510),
  ('hr.recruitment.hire',            'HR: send offers and hire applicants',                       520),
  ('hr.recruitment.compliance.read', 'HR: read police clearance, register and permit details',    530),
  ('hr.questions.write',             'HR: edit interview question banks and approve questions',   540),
  ('hr.employees.read',              'HR: view employee records',                                 550),
  ('hr.employees.write',             'HR: edit employee records and contracts',                   560),
  ('hr.employees.sensitive.read',    'HR: read ID numbers, dates of birth and next of kin',       570),
  ('hr.compensation.read',           'HR: view salaries and bank details',                        580),
  ('hr.compensation.write',          'HR: change salaries, pay items and bank details',           590),
  ('hr.timesheets.write',            'HR: capture timesheets',                                    600),
  ('hr.payroll.read',                'HR: view payroll runs and payslips',                        610),
  ('hr.payroll.prepare',             'HR: prepare and calculate payroll runs',                    620),
  ('hr.payroll.approve',             'HR: approve and lock payroll runs',                         630),
  ('hr.leave.approve',               'HR: approve leave',                                         640),
  ('hr.disciplinary.read',           'HR: view disciplinary cases',                               650),
  ('hr.disciplinary.write',          'HR: open and manage disciplinary cases',                    660),
  ('hr.templates.write',             'HR: edit HR email templates',                               670),
  ('hr.settings.write',              'HR: change HR settings, departments and leave types',       680),
  ('hr.tax_tables.write',            'HR: publish tax tables',                                    690),
  ('hr.audit.read',                  'HR: read the HR audit trail',                               700),
  ('hr.export',                      'HR: export HR data',                                        710)
on conflict (code) do update set label = excluded.label, sort_order = excluded.sort_order;

insert into public.roles (code, name, description, is_system, campus_scoped) values
  ('hr_manager',      'HR manager',      'Everything in the HR app, including payroll approval.', true, false),
  ('hr_staff',        'HR staff',        'Recruitment, employee records, leave and timesheets. No salaries.', true, false),
  ('payroll_officer', 'Payroll officer', 'Salaries, timesheets, payroll runs and tax tables.', true, false),
  ('hr_interviewer',  'Interviewer',     'Reads applicants at their own campus, for principals on an interview panel.', true, true)
on conflict (code) do update set name = excluded.name, description = excluded.description,
  campus_scoped = excluded.campus_scoped;

with grants(role_code, permission_code) as (
  values
    ('hr_manager', 'hr.recruitment.read'),
    ('hr_manager', 'hr.recruitment.write'),
    ('hr_manager', 'hr.recruitment.hire'),
    ('hr_manager', 'hr.recruitment.compliance.read'),
    ('hr_manager', 'hr.questions.write'),
    ('hr_manager', 'hr.employees.read'),
    ('hr_manager', 'hr.employees.write'),
    ('hr_manager', 'hr.employees.sensitive.read'),
    ('hr_manager', 'hr.compensation.read'),
    ('hr_manager', 'hr.compensation.write'),
    ('hr_manager', 'hr.timesheets.write'),
    ('hr_manager', 'hr.payroll.read'),
    ('hr_manager', 'hr.payroll.prepare'),
    ('hr_manager', 'hr.payroll.approve'),
    ('hr_manager', 'hr.leave.approve'),
    ('hr_manager', 'hr.disciplinary.read'),
    ('hr_manager', 'hr.disciplinary.write'),
    ('hr_manager', 'hr.templates.write'),
    ('hr_manager', 'hr.settings.write'),
    ('hr_manager', 'hr.tax_tables.write'),
    ('hr_manager', 'hr.audit.read'),
    ('hr_manager', 'hr.export'),

    ('hr_staff', 'hr.recruitment.read'),
    ('hr_staff', 'hr.recruitment.write'),
    ('hr_staff', 'hr.recruitment.compliance.read'),
    ('hr_staff', 'hr.questions.write'),
    ('hr_staff', 'hr.employees.read'),
    ('hr_staff', 'hr.employees.write'),
    ('hr_staff', 'hr.leave.approve'),
    ('hr_staff', 'hr.disciplinary.read'),
    ('hr_staff', 'hr.timesheets.write'),

    ('payroll_officer', 'hr.employees.read'),
    ('payroll_officer', 'hr.compensation.read'),
    ('payroll_officer', 'hr.compensation.write'),
    ('payroll_officer', 'hr.timesheets.write'),
    ('payroll_officer', 'hr.payroll.read'),
    ('payroll_officer', 'hr.payroll.prepare'),
    ('payroll_officer', 'hr.tax_tables.write'),
    ('payroll_officer', 'hr.export'),

    ('hr_interviewer', 'hr.recruitment.read')
)
insert into public.role_permissions (role_id, permission_code)
select r.id, g.permission_code
from grants g
join public.roles r on r.code = g.role_code
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- A strict permission check for pay.
--
-- `has_permission()` answers yes to every code for a holder of `admin`, which
-- is right for admissions and wrong for salaries: the admissions super
-- administrator should not read every teacher's pay because they can change
-- an offer letter. Pay, bank details and payslips use this instead, which
-- needs the code itself on one of the person's roles.
-- ---------------------------------------------------------------------------

create or replace function public.hr_has_strict(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_roles sr
    join public.role_permissions rp on rp.role_id = sr.role_id
    join public.staff_profiles sp on sp.id = sr.staff_id
    where sr.staff_id = auth.uid()
      and sp.is_active
      and rp.permission_code = p_code
  )
$$;

revoke execute on function public.hr_has_strict(text) from public, anon;
grant execute on function public.hr_has_strict(text) to authenticated;

-- Any HR permission at all: who may read the HR settings and lookups.
create or replace function public.hr_is_hr_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_roles sr
    join public.role_permissions rp on rp.role_id = sr.role_id
    join public.staff_profiles sp on sp.id = sr.staff_id
    where sr.staff_id = auth.uid()
      and sp.is_active
      and (rp.permission_code like 'hr.%' or rp.permission_code = 'admin')
  )
$$;

revoke execute on function public.hr_is_hr_staff() from public, anon;
grant execute on function public.hr_is_hr_staff() to authenticated;

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

create table if not exists public.hr_settings (
  key text primary key,
  value jsonb not null,
  label text not null,
  updated_by uuid references public.staff_profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

drop trigger if exists hr_settings_set_updated_at on public.hr_settings;
create trigger hr_settings_set_updated_at
  before update on public.hr_settings
  for each row execute function public.set_updated_at();

insert into public.hr_settings (key, value, label) values
  ('reference_reminder_days', '[3, 7]'::jsonb, 'Days after the request to remind a referee'),
  ('reference_expiry_days', '14'::jsonb, 'Days a reference link stays open'),
  ('draft_expiry_days', '30'::jsonb, 'Days an unfinished application is kept'),
  ('unsuccessful_retention_months', '12'::jsonb, 'Months an unsuccessful applicant is kept before anonymising'),
  ('talent_pool_retention_months', '24'::jsonb, 'Months an applicant who joined the talent pool is kept'),
  ('scoring_weights', '{"qualifications": 25, "experience": 20, "answers": 30, "references": 15, "communication": 10}'::jsonb,
     'Points per quality in the score out of 100'),
  ('ai_marking_enabled', 'true'::jsonb, 'Mark written answers with AI (a person can always override)'),
  ('ai_integrity_enabled', 'true'::jsonb, 'Check every application''s answers for AI-written text'),
  ('integrity_notice',
     '"Write every answer yourself. We check all answers for text written by AI tools such as ChatGPT. Answers that look AI-written are flagged, and you may be asked to explain them in your interview."'::jsonb,
     'The notice applicants must tick before answering the questions'),
  ('privacy_notice_version', '"2026-10"'::jsonb, 'The privacy notice applicants agree to'),
  ('min_referees', '2'::jsonb, 'The fewest referees an applicant may give'),
  ('max_referees', '3'::jsonb, 'The most referees an applicant may give')
on conflict (key) do nothing;

alter table public.hr_settings enable row level security;

drop policy if exists hr_settings_select on public.hr_settings;
create policy hr_settings_select on public.hr_settings
  for select using ((select public.hr_is_hr_staff()));

drop policy if exists hr_settings_update on public.hr_settings;
create policy hr_settings_update on public.hr_settings
  for update using ((select public.has_permission('hr.settings.write')));

-- No insert or delete policy: the keys are the code's, seeded here.

-- ---------------------------------------------------------------------------
-- The HR audit log
-- ---------------------------------------------------------------------------

create table if not exists public.hr_audit_log (
  id bigint generated always as identity primary key,
  actor_type text not null check (actor_type in ('staff', 'applicant', 'referee', 'employee', 'system')),
  actor_id uuid,
  actor_label text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  campus_id uuid references public.campuses(id) on delete set null,
  hr_application_id uuid,
  hr_employee_id uuid,
  -- Who may read the row. A salary change is `compensation` and is shown only
  -- to people who may read pay; a police clearance edit is `compliance`.
  sensitivity text not null default 'normal' check (sensitivity in ('normal', 'compensation', 'compliance')),
  before jsonb,
  after jsonb,
  ip_hash text,
  occurred_at timestamptz not null default now()
);

create index if not exists hr_audit_log_application_idx on public.hr_audit_log (hr_application_id, id desc);
create index if not exists hr_audit_log_employee_idx on public.hr_audit_log (hr_employee_id, id desc);
create index if not exists hr_audit_log_entity_idx on public.hr_audit_log (entity_type, entity_id);

comment on table public.hr_audit_log is
  'Append-only. Written by the HR app under the service role. No role may update or delete a row, which is why there is no update or delete policy.';

alter table public.hr_audit_log enable row level security;

drop policy if exists hr_audit_log_select on public.hr_audit_log;
create policy hr_audit_log_select on public.hr_audit_log
  for select using (
    (select public.has_permission('hr.audit.read'))
    and (campus_id is null or public.can_access_campus(campus_id))
    and (
      sensitivity = 'normal'
      or (sensitivity = 'compensation' and (select public.hr_has_strict('hr.compensation.read')))
      or (sensitivity = 'compliance' and (select public.has_permission('hr.recruitment.compliance.read')))
    )
  );

-- ---------------------------------------------------------------------------
-- The HR job queue
-- ---------------------------------------------------------------------------

create table if not exists public.hr_jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  run_after timestamptz not null default now(),
  -- An assertion about the state this job assumes, checked immediately before
  -- it runs: {"reference_request_status": ["sent", "opened"]}.
  precondition jsonb,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed', 'skipped')),
  attempts int not null default 0,
  max_attempts int not null default 5,
  last_error text,
  locked_at timestamptz,
  locked_by text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists hr_jobs_set_updated_at on public.hr_jobs;
create trigger hr_jobs_set_updated_at
  before update on public.hr_jobs
  for each row execute function public.set_updated_at();

create index if not exists hr_jobs_due_idx on public.hr_jobs (run_after) where status = 'pending';

create or replace function public.hr_claim_jobs(p_worker text, p_limit int default 20)
returns setof public.hr_jobs
language sql
security invoker
set search_path = public
as $$
  update public.hr_jobs
     set status = 'running',
         locked_at = now(),
         locked_by = p_worker,
         attempts = attempts + 1
   where id in (
     select id
       from public.hr_jobs
      where (
              status = 'pending'
              or (status = 'running' and locked_at < now() - interval '10 minutes')
            )
        and run_after <= now()
      order by run_after
      for update skip locked
      limit p_limit
   )
  returning *
$$;

revoke execute on function public.hr_claim_jobs(text, int) from public, anon, authenticated;

alter table public.hr_jobs enable row level security;

-- Visible to administrators for diagnosis. Written only by the HR app under
-- the service role, so there is no write policy.
drop policy if exists hr_jobs_select on public.hr_jobs;
create policy hr_jobs_select on public.hr_jobs
  for select using ((select public.has_permission('admin')));

create table if not exists public.hr_drain_runs (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  source text not null check (source in ('schedule', 'request', 'manual')),
  claimed int not null default 0,
  done int not null default 0,
  skipped int not null default 0,
  failed int not null default 0,
  duration_ms int not null default 0,
  detail jsonb
);

create index if not exists hr_drain_runs_recent_idx on public.hr_drain_runs (source, ran_at desc);

alter table public.hr_drain_runs enable row level security;

drop policy if exists hr_drain_runs_select on public.hr_drain_runs;
create policy hr_drain_runs_select on public.hr_drain_runs
  for select using ((select public.has_permission('admin')));

-- The five-minute schedule. Reads the HR app's drain address and secret from
-- Vault, set once per project:
--   select vault.create_secret('https://hr.<domain>/api/jobs/drain', 'hr_drain_url');
--   select vault.create_secret('<CRON_SECRET of the HR app>', 'hr_drain_cron_secret');
-- With either missing it does nothing, so a fresh project is quiet rather
-- than failing every five minutes.
create or replace function public.hr_drain_tick()
returns bigint
language plpgsql
security definer
set search_path = public, net, vault
as $$
declare
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'hr_drain_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'hr_drain_cron_secret';
  if v_url is null or v_secret is null then
    return null;
  end if;
  select net.http_get(
    url := v_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 55000
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke execute on function public.hr_drain_tick() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    execute 'create extension if not exists pg_cron';
    execute 'create extension if not exists pg_net';
    execute $q$
      select cron.unschedule(jobid) from cron.job where jobname = 'hr-drain-every-five-minutes'
    $q$;
    execute $q$
      select cron.schedule('hr-drain-every-five-minutes', '*/5 * * * *', 'select public.hr_drain_tick()')
    $q$;
  else
    raise notice 'pg_cron/pg_net not available here — the HR drain is not scheduled in this database.';
  end if;
end $$;
