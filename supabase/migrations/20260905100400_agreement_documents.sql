-- Agreements that point at the school's published documents.
--
-- The school publishes its policies as PDFs on its website's policy
-- download centre. An agreement may now carry the link to the document it
-- stands for, shown to the parent beside the tick so they can read the
-- full text before signing. The acceptance still records the body hash and
-- version of the wording shown here; the document's own content is the
-- school's to keep current at that link.

alter table public.agreement_templates
  add column if not exists document_url text
    check (document_url is null or document_url ~ '^https://');

comment on column public.agreement_templates.document_url is
  'The published document (a PDF on the school website) this agreement stands for; shown as "Read the full document" beside the tick.';

-- publish_agreement_template gains the link. The old signature goes so the
-- name resolves to one function; a five-argument call still works through
-- the default.
drop function if exists public.publish_agreement_template(text, text, text, text, boolean);

create or replace function public.publish_agreement_template(
  p_key text,
  p_name text,
  p_description text,
  p_body_html text,
  p_required boolean,
  p_document_url text default null
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
  if p_document_url is not null and p_document_url !~ '^https://' then
    raise exception 'document_url_invalid';
  end if;
  select coalesce(max(version), 0) + 1 into v_next from public.agreement_templates where key = p_key;
  update public.agreement_templates set is_active = false where key = p_key and is_active;
  insert into public.agreement_templates (key, version, name, description, body_html, required, document_url, is_active, created_by)
  values (p_key, v_next, p_name, p_description, p_body_html, p_required, p_document_url, true, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.publish_agreement_template(text, text, text, text, boolean, text) from public, anon;
grant execute on function public.publish_agreement_template(text, text, text, text, boolean, text) to authenticated;

-- The two documents the school publishes for enrolment, from
-- https://hibiscusschools.com/policy-download-center/. The wording here is
-- the acknowledgement a parent signs; the document itself is read at the
-- link. The school may paste the full text into the body under Set up →
-- Agreements, which publishes a new version.
insert into public.agreement_templates (key, name, description, body_html, required, document_url)
values
  ('parent_acknowledgement_agreement',
   'Parent Acknowledgement and Agreement 2026',
   'The school''s Parent Acknowledgement and Agreement, published on the policy download centre. The parent reads the PDF at the link and signs the acknowledgement here.',
   '<h2>Parent Acknowledgement and Agreement 2026</h2><p>The Parent Acknowledgement and Agreement sets out what Hibiscus Schools and the family undertake to each other: fees and payment, attendance, communication, conduct and the school''s policies. Please read the full document using the link below before signing.</p><p>By signing you confirm that you have read and understood the 2026 Parent Acknowledgement and Agreement as published by Hibiscus Schools, and that you agree to be bound by it for the duration of your child''s enrolment.</p>',
   true,
   'https://hibiscusschools.com/wp-content/uploads/2026/01/2026-Parent_Acknowledgement_and_Agreement.pdf'),
  ('learner_code_of_conduct',
   'Learner Code of Conduct 2026',
   'The school''s Learner Code of Conduct, published on the policy download centre. The parent reads it with their child and signs the acknowledgement here.',
   '<h2>Learner Code of Conduct 2026</h2><p>The Learner Code of Conduct describes the behaviour Hibiscus Schools expects of every learner, and what happens when it is not met. Please read the full document using the link below, and go through it with your child, before signing.</p><p>By signing you confirm that you have read the 2026 Learner Code of Conduct with your child, that you have explained it to them, and that you will support the school in upholding it.</p>',
   true,
   'https://hibiscusschools.com/wp-content/uploads/2026/01/2026-Learner-Code-of-Conduct.pdf')
on conflict (key, version) do nothing;

-- The Phase 3 placeholders retire, but only while they are still the
-- placeholders: a school that already replaced their wording keeps it.
update public.agreement_templates
   set is_active = false
 where key in ('school_agreement', 'policies')
   and is_active
   and body_html like '%This is placeholder wording%';
