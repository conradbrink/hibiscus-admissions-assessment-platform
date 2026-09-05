-- Document extraction and application summaries.
--
-- Extraction reads a birth certificate or a report and proposes values.
-- It writes the proposal onto the document row and, when a proposal
-- disagrees with what the parent typed, a flag onto the registration and a
-- task for a person. It never writes a registration field: the parent's
-- next save is the correction, and staff "accept document" is unchanged.
--
-- A summary is the applicant's story in a paragraph, for the staff page:
-- the facts and the attention flags are computed in code; the model, when
-- switched on, only writes prose over them and is validated like the
-- learning-profile narrative. The row is cached by a hash of its inputs.

-- ---------------------------------------------------------------------------
-- Documents: what the extractor found, and when
-- ---------------------------------------------------------------------------

alter table public.documents
  add column if not exists extraction_model text,
  add column if not exists extraction_error text,
  add column if not exists extracted_at timestamptz;

comment on column public.documents.extracted_fields is
  'What the extractor read from the file, with a confidence. A proposal only: nothing here is copied into the registration without the parent.';

-- Disagreements between a document and the registration, per field, for
-- the parent''s form to show and clear on save.
alter table public.registrations
  add column if not exists mismatch_flags jsonb not null default '[]'::jsonb;

comment on column public.registrations.mismatch_flags is
  '[{field, label, registration_value, document_value, requirement_code, document_id}] — cleared when the parent saves the section.';

-- ---------------------------------------------------------------------------
-- Application summaries: computed facts and flags, optional AI prose
-- ---------------------------------------------------------------------------

create table if not exists public.application_summaries (
  application_id uuid primary key references public.applications(id) on delete cascade,
  -- sha256 of the facts and flags the prose was written over; a different
  -- hash means the prose is stale.
  input_hash text not null,
  facts jsonb not null default '[]'::jsonb,
  flags jsonb not null default '[]'::jsonb,
  headline text not null,
  paragraph text not null,
  source text not null check (source in ('ai', 'deterministic')),
  model text,
  prompt_version text,
  validation_errors jsonb,
  generated_at timestamptz not null default now(),
  generated_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists application_summaries_set_updated_at on public.application_summaries;
create trigger application_summaries_set_updated_at
  before update on public.application_summaries
  for each row execute function public.set_updated_at();

alter table public.application_summaries enable row level security;

-- Visible with the application; written by the engine only.
drop policy if exists application_summaries_select on public.application_summaries;
create policy application_summaries_select on public.application_summaries
  for select using (
    exists (
      select 1 from public.applications a
      where a.id = application_summaries.application_id
        and (select public.has_permission('applications.read'))
        and (select public.can_access_campus(a.campus_id))
    )
  );

-- ---------------------------------------------------------------------------
-- Switches
-- ---------------------------------------------------------------------------

insert into public.settings (key, value, description)
values
  ('ai_extraction_enabled', 'false'::jsonb,
   'Read uploaded birth certificates and reports with the AI document extractor and flag disagreements with the registration for the parent to confirm. Needs DOCUMENT_EXTRACTOR configured.'),
  ('ai_summary_enabled', 'false'::jsonb,
   'Let the AI write the one-paragraph applicant summary on the staff page over the computed facts. Off: the summary is the facts, worded by the system.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- The email that asks a parent to check a detail against their document
-- ---------------------------------------------------------------------------

insert into public.email_templates (key, name, description, subject, body_text, body_html, allowed_variables)
values
(
  'document_mismatch',
  'Please check a detail on the registration',
  'Sent by staff when a document the parent uploaded shows a different value from what they typed on the registration.',
  'Please check {{student_first_name}}''s registration details',
  E'Dear {{parent_first_name}},\n\nThank you for uploading {{student_first_name}}''s documents. One detail on a document does not match what was typed on the registration form:\n\n{{mismatch_details}}\n\nPlease open the registration, check the detail against the document, and save the correct value. If the document is right, simply correct the form; if the form is right, no change is needed and the school will follow up.\n\n{{registration_link}}\n\nReference: {{application_reference}}\n\nKind regards,\nHibiscus Schools Admissions',
  '<p>Dear {{parent_first_name}},</p><p>Thank you for uploading {{student_first_name}}''s documents. One detail on a document does not match what was typed on the registration form:</p><p style="white-space:pre-line"><strong>{{mismatch_details}}</strong></p><p>Please open the registration, check the detail against the document, and save the correct value. If the document is right, simply correct the form; if the form is right, no change is needed and the school will follow up.</p><p><a href="{{registration_link}}" class="button">Open the registration</a></p><p>Reference: {{application_reference}}</p><p>Kind regards,<br>Hibiscus Schools Admissions</p>',
  array['parent_first_name','student_first_name','application_reference','mismatch_details','registration_link','next_step_link']
)
on conflict (key, version) do nothing;
