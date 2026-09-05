-- Final registration: the detailed information the old application form
-- asked for up front, collected only after the offer is accepted and paid.
--
-- Typed columns for the spec's fields; contacts (guardians and emergency
-- contacts) in one table; documents as rows pointing at a private storage
-- bucket the service role alone touches; agreements as versioned templates
-- with an acceptance record per family. What a parent already told us is
-- shown back for confirmation, never asked again.
--
-- Nothing here references storage.*: the bucket is created by the
-- application at first use, and there are no storage policies because
-- nothing but the service role ever reads or writes an object.

-- ---------------------------------------------------------------------------
-- Registrations: one per application
-- ---------------------------------------------------------------------------

create table if not exists public.registrations (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade unique,
  -- Student
  legal_first_name text,
  legal_middle_names text,
  legal_last_name text,
  preferred_name text,
  gender text check (gender is null or gender in ('female', 'male', 'other', 'undisclosed')),
  date_of_birth date,
  nationality text,
  country_of_birth text,
  place_of_birth text,
  home_language text,
  identity_type text check (identity_type is null or identity_type in ('omang', 'passport', 'birth_certificate', 'other')),
  identity_number text,
  previous_institution text,
  current_grade text,
  -- Medical
  medical_aid_name text,
  medical_aid_number text,
  medical_aid_principal_member text,
  emergency_treatment_consent boolean,
  allergies text,
  medical_conditions text,
  medication text,
  medical_notes text,
  vaccination_notes text,
  -- Progress: a section is complete when its stamp is set
  student_completed_at timestamptz,
  medical_completed_at timestamptz,
  family_completed_at timestamptz,
  emergency_completed_at timestamptz,
  documents_completed_at timestamptz,
  agreements_completed_at timestamptz,
  submitted_at timestamptz,
  submitted_ip_hash text,
  -- Fields the parent changed from what the application already held, e.g.
  -- ["child_first_name", "child_date_of_birth"]; staff review those.
  prefill_changed jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists registrations_set_updated_at on public.registrations;
create trigger registrations_set_updated_at
  before update on public.registrations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Guardians and emergency contacts
-- ---------------------------------------------------------------------------

create table if not exists public.registration_contacts (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  kind text not null check (kind in ('primary_guardian', 'secondary_guardian', 'emergency')),
  position int not null default 1 check (position >= 1),
  -- The primary guardian is the enquiring contact; linked so the two agree.
  contact_id uuid references public.contacts(id) on delete set null,
  first_name text not null,
  last_name text not null,
  relationship text not null check (relationship in ('mother', 'father', 'parent', 'guardian', 'grandparent', 'other')),
  email text,
  mobile text,
  mobile_normalised text,
  phone text,
  address text,
  nationality text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, kind, position)
);

drop trigger if exists registration_contacts_set_updated_at on public.registration_contacts;
create trigger registration_contacts_set_updated_at
  before update on public.registration_contacts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Document requirements: reference data the school edits
-- ---------------------------------------------------------------------------

create table if not exists public.document_requirements (
  code text primary key check (code ~ '^[a-z0-9_]+$'),
  label text not null,
  description text,
  required boolean not null default true,
  -- Null on both: every grade. The same band convention as fee schedules.
  grade_sort_min int,
  grade_sort_max int,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (grade_sort_min is null or grade_sort_max is null or grade_sort_max >= grade_sort_min)
);

drop trigger if exists document_requirements_set_updated_at on public.document_requirements;
create trigger document_requirements_set_updated_at
  before update on public.document_requirements
  for each row execute function public.set_updated_at();

insert into public.document_requirements (code, label, description, required, grade_sort_min, grade_sort_max, sort_order) values
  ('birth_certificate',     'Birth certificate',                   'A copy of the child''s birth certificate or passport.', true,  null, null, 10),
  ('vaccination_card',      'Vaccination card',                    'The child''s immunisation record.',                     true,  null, null, 20),
  ('school_report',         'Latest school report',                'The most recent report from the current school.',       true,  60,   null, 30),
  ('transfer_certificate',  'Transfer certificate',                'From the current school, if the child is transferring.', true, 60,   null, 40),
  ('medical_special_needs', 'Medical or special-needs documentation', 'Only where relevant: a doctor''s letter, an assessment report, a care plan.', false, null, null, 50)
on conflict (code) do nothing;

-- The codes a child in a given grade must supply. Mirrors
-- lib/registration/completeness.ts; used by dashboard_counts.
create or replace function public.required_document_codes(p_grade_sort int)
returns setof text
language sql
stable
security invoker
set search_path = public
as $$
  select code
  from public.document_requirements
  where is_active and required
    and (grade_sort_min is null or grade_sort_min <= p_grade_sort)
    and (grade_sort_max is null or grade_sort_max >= p_grade_sort)
  order by sort_order
$$;

revoke execute on function public.required_document_codes(int) from public, anon;
grant execute on function public.required_document_codes(int) to authenticated;

-- ---------------------------------------------------------------------------
-- Documents: rows here, bytes in a private bucket
-- ---------------------------------------------------------------------------

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  requirement_code text not null references public.document_requirements(code) on delete restrict,
  storage_bucket text not null default 'applicant-documents',
  -- applications/<application_id>/<uuid>: nothing a parent typed is in the path.
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text not null,
  uploaded_by text not null check (uploaded_by in ('parent', 'staff')),
  uploaded_by_staff_id uuid references public.staff_profiles(id) on delete set null,
  scan_status text not null default 'not_scanned' check (scan_status in ('not_scanned', 'clean', 'infected', 'error')),
  scanner text,
  review_status text not null default 'pending' check (review_status in ('pending', 'accepted', 'rejected')),
  reviewed_by uuid references public.staff_profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  -- Phase 4 seam: extraction never overwrites what a parent typed; a
  -- disagreement becomes a staff task.
  extraction_status text not null default 'not_run' check (extraction_status in ('not_run', 'pending', 'done', 'failed')),
  extracted_fields jsonb,
  superseded_by uuid references public.documents(id) on delete set null,
  deleted_at timestamptz,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

create unique index if not exists documents_one_live_idx
  on public.documents(application_id, requirement_code)
  where superseded_by is null and deleted_at is null;

create index if not exists documents_application_idx on public.documents(application_id);

-- ---------------------------------------------------------------------------
-- Agreements: versioned wording, accepted by name
-- ---------------------------------------------------------------------------

create table if not exists public.agreement_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null check (key ~ '^[a-z0-9_]+$'),
  version int not null default 1,
  name text not null,
  description text,
  body_html text not null,
  required boolean not null default true,
  is_active boolean not null default true,
  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (key, version)
);

drop trigger if exists agreement_templates_set_updated_at on public.agreement_templates;
create trigger agreement_templates_set_updated_at
  before update on public.agreement_templates
  for each row execute function public.set_updated_at();

create unique index if not exists agreement_templates_one_active_idx
  on public.agreement_templates(key)
  where is_active;

-- Publishing a new version, or a new agreement. Unlike the email and offer
-- RPCs this accepts a new key: there is no variable allow-list to carry
-- forward, only wording.
create or replace function public.publish_agreement_template(
  p_key text,
  p_name text,
  p_description text,
  p_body_html text,
  p_required boolean
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_next int;
  v_id uuid;
begin
  if not public.has_permission('templates.write') then
    raise exception 'permission_denied';
  end if;
  if p_key !~ '^[a-z0-9_]+$' then
    raise exception 'template_key_invalid';
  end if;
  select coalesce(max(version), 0) + 1 into v_next from public.agreement_templates where key = p_key;
  update public.agreement_templates set is_active = false where key = p_key and is_active;
  insert into public.agreement_templates (key, version, name, description, body_html, required, is_active, created_by)
  values (p_key, v_next, p_name, p_description, p_body_html, p_required, true, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.publish_agreement_template(text, text, text, text, boolean) from public, anon;
grant execute on function public.publish_agreement_template(text, text, text, text, boolean) to authenticated;

insert into public.agreement_templates (key, name, description, body_html, required)
values
  ('school_agreement', 'Enrolment agreement', 'The agreement between the school and the family. Placeholder wording: replace with the school''s own before going live.',
   '<h2>Enrolment agreement</h2><p>By enrolling a child at Hibiscus Schools the parent or guardian agrees to the school''s fee policy, code of conduct, attendance expectations and communication practices as published by the school and updated from time to time.</p><p><em>This is placeholder wording. The school''s own agreement replaces it in the console under Set up → Agreements.</em></p>', true),
  ('policies', 'School policies', 'Acknowledgement of the published policies. Placeholder wording.',
   '<h2>School policies</h2><p>I confirm that I have read the school''s published policies, including those on safeguarding, health and medication, data protection and the use of photographs, and that I will raise any question about them with the school before my child starts.</p><p><em>This is placeholder wording. The school''s own text replaces it in the console under Set up → Agreements.</em></p>', true)
on conflict (key, version) do nothing;

create table if not exists public.agreement_acceptances (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  agreement_template_id uuid not null references public.agreement_templates(id) on delete restrict,
  template_key text not null,
  template_version int not null,
  -- sha256 (base64url) of the body as shown.
  body_hash text not null,
  -- The typed full name is the electronic signature.
  signature_name text not null,
  ip_hash text,
  user_agent text,
  accepted_at timestamptz not null default now(),
  unique (application_id, agreement_template_id)
);

create index if not exists agreement_acceptances_application_idx on public.agreement_acceptances(application_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.registrations enable row level security;
alter table public.registration_contacts enable row level security;
alter table public.document_requirements enable row level security;
alter table public.documents enable row level security;
alter table public.agreement_templates enable row level security;
alter table public.agreement_acceptances enable row level security;

-- Registration data is read with the application. Written by the parent
-- (service role) and reviewed by staff through the engine; no staff write
-- policy, so a correction is a task and a note until an edit screen exists.
drop policy if exists registrations_select on public.registrations;
create policy registrations_select on public.registrations
  for select using (
    exists (
      select 1 from public.applications a
      where a.id = registrations.application_id
        and (select public.has_permission('applications.read'))
        and (select public.can_access_campus(a.campus_id))
    )
  );

drop policy if exists registration_contacts_select on public.registration_contacts;
create policy registration_contacts_select on public.registration_contacts
  for select using (
    exists (
      select 1 from public.applications a
      where a.id = registration_contacts.application_id
        and (select public.has_permission('applications.read'))
        and (select public.can_access_campus(a.campus_id))
    )
  );

drop policy if exists document_requirements_select on public.document_requirements;
create policy document_requirements_select on public.document_requirements
  for select using ((select public.current_staff_id()) is not null);
drop policy if exists document_requirements_write on public.document_requirements;
create policy document_requirements_write on public.document_requirements
  for all using ((select public.has_permission('settings.write')))
  with check ((select public.has_permission('settings.write')));

-- Document rows are visible with the application; the bytes are reachable
-- only through the route that reads this row first and mints a short signed
-- URL. Review goes through the engine; no staff write.
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
  for select using (
    exists (
      select 1 from public.applications a
      where a.id = documents.application_id
        and (select public.has_permission('applications.read'))
        and (select public.can_access_campus(a.campus_id))
    )
  );

drop policy if exists agreement_templates_select on public.agreement_templates;
create policy agreement_templates_select on public.agreement_templates
  for select using ((select public.current_staff_id()) is not null);
drop policy if exists agreement_templates_insert on public.agreement_templates;
create policy agreement_templates_insert on public.agreement_templates
  for insert with check (
    (select public.has_permission('templates.write'))
    and created_by = (select auth.uid())
  );
drop policy if exists agreement_templates_update on public.agreement_templates;
create policy agreement_templates_update on public.agreement_templates
  for update using ((select public.has_permission('templates.write')));
-- No delete: a version that was ever active was accepted by somebody.

drop policy if exists agreement_acceptances_select on public.agreement_acceptances;
create policy agreement_acceptances_select on public.agreement_acceptances
  for select using (
    exists (
      select 1 from public.applications a
      where a.id = agreement_acceptances.application_id
        and (select public.has_permission('applications.read'))
        and (select public.can_access_campus(a.campus_id))
    )
  );

-- ---------------------------------------------------------------------------
-- Settings and templates
-- ---------------------------------------------------------------------------

insert into public.settings (key, value, description) values
  ('registration_reminder_days', '[7, 14]', 'Days after payment at which a parent who has not completed registration is reminded.'),
  ('auto_enrol',                 'false',   'When true, a complete registration is enrolled and welcomed without a person confirming it.')
on conflict (key) do nothing;

insert into public.email_templates (key, name, description, subject, body_text, body_html, allowed_variables)
values
(
  'registration_reminder',
  'Registration reminder',
  'Sent after payment while registration is incomplete.',
  'A reminder to complete {{student_first_name}}''s registration',
  E'Dear {{parent_first_name}},\n\n{{student_first_name}}''s place is secured. To finish, please complete the registration form: the details the school needs before the first day.\n{{#if missing_documents}}\nStill needed: {{missing_documents}}\n{{/if}}\nContinue here:\n{{registration_link}}\n\nReference: {{application_reference}}\n\nHibiscus Schools Admissions',
  '<p>Dear {{parent_first_name}},</p><p>{{student_first_name}}''s place is secured. To finish, please complete the registration form: the details the school needs before the first day.</p>{{#if missing_documents}}<p>Still needed: <strong>{{missing_documents}}</strong></p>{{/if}}<p><a href="{{registration_link}}" class="button">Continue registration</a></p><p>Reference: {{application_reference}}</p><p>Hibiscus Schools Admissions</p>',
  array['parent_first_name','student_first_name','application_reference','registration_link','missing_documents','next_step_link']
),
(
  'documents_missing',
  'Documents still needed',
  'Sent when registration is submitted with a required document missing, or a document is not accepted.',
  'Documents still needed for {{student_first_name}}''s registration',
  E'Dear {{parent_first_name}},\n\nThank you for completing {{student_first_name}}''s registration. Before we can confirm enrolment we still need:\n\n{{missing_documents}}\n\nYou can upload them here:\n{{registration_link}}\n\nA clear photo taken with a phone is fine, as is a PDF.\n\nReference: {{application_reference}}\n\nHibiscus Schools Admissions',
  '<p>Dear {{parent_first_name}},</p><p>Thank you for completing {{student_first_name}}''s registration. Before we can confirm enrolment we still need:</p><p><strong>{{missing_documents}}</strong></p><p><a href="{{registration_link}}" class="button">Upload documents</a></p><p>A clear photo taken with a phone is fine, as is a PDF.</p><p>Reference: {{application_reference}}</p><p>Hibiscus Schools Admissions</p>',
  array['parent_first_name','student_first_name','application_reference','registration_link','missing_documents','next_step_link']
)
on conflict (key, version) do nothing;
