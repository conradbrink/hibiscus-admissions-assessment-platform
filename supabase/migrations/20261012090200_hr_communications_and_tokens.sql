-- ===========================================================================
-- HR communications and magic links.
--
-- HR has its own templates, message log and tokens rather than sharing the
-- admissions ones: those are bound to applications and contacts by foreign
-- keys, edited under admissions' `templates.write`, and shown in admissions'
-- template editor. Every word an applicant, referee or employee reads is a
-- row here, written in plain English (CEFR B1 to B2).
-- ===========================================================================

create table if not exists public.hr_email_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  version int not null default 1,
  audience text not null check (audience in ('applicant', 'referee', 'employee', 'staff')),
  name text not null,
  description text,
  subject text not null,
  body_html text not null,
  body_text text not null,
  allowed_variables text[] not null default '{}'::text[],
  is_active boolean not null default true,
  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (key, version)
);

drop trigger if exists hr_email_templates_set_updated_at on public.hr_email_templates;
create trigger hr_email_templates_set_updated_at
  before update on public.hr_email_templates
  for each row execute function public.set_updated_at();

create unique index if not exists hr_email_templates_one_active_idx
  on public.hr_email_templates (key)
  where is_active;

create table if not exists public.hr_email_messages (
  id uuid primary key default gen_random_uuid(),
  hr_application_id uuid references public.hr_applications(id) on delete set null,
  hr_reference_request_id uuid references public.hr_reference_requests(id) on delete set null,
  hr_employee_id uuid,
  template_key text,
  template_version int,
  to_email text not null,
  subject text not null,
  body_html text not null,
  body_text text not null,
  provider text not null,
  provider_message_id text,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed')),
  error text,
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  bounced_at timestamptz,
  bounce_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists hr_email_messages_set_updated_at on public.hr_email_messages;
create trigger hr_email_messages_set_updated_at
  before update on public.hr_email_messages
  for each row execute function public.set_updated_at();

create index if not exists hr_email_messages_application_idx on public.hr_email_messages (hr_application_id, created_at desc);
create index if not exists hr_email_messages_provider_idx on public.hr_email_messages (provider_message_id)
  where provider_message_id is not null;
create index if not exists hr_email_messages_created_idx on public.hr_email_messages (created_at desc);

-- A new version of a template, made active. The allow-list is the code's and
-- is carried over unchanged: a template may only use what its sender fills.
create or replace function public.hr_publish_email_template(
  p_key text,
  p_subject text,
  p_body_html text,
  p_body_text text
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_current public.hr_email_templates%rowtype;
  v_id uuid;
begin
  if not public.has_permission('hr.templates.write') then
    raise exception 'permission_denied';
  end if;
  select * into v_current from public.hr_email_templates
   where key = p_key order by version desc limit 1;
  if not found then
    raise exception 'template_key_unknown';
  end if;
  update public.hr_email_templates set is_active = false where key = p_key and is_active;
  insert into public.hr_email_templates (
    key, version, audience, name, description, subject, body_html, body_text, allowed_variables, is_active, created_by
  ) values (
    p_key, v_current.version + 1, v_current.audience, v_current.name, v_current.description,
    p_subject, p_body_html, p_body_text, v_current.allowed_variables, true, auth.uid()
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.hr_publish_email_template(text, text, text, text) from public, anon;
grant execute on function public.hr_publish_email_template(text, text, text, text) to authenticated;

alter table public.hr_email_templates enable row level security;
alter table public.hr_email_messages enable row level security;

drop policy if exists hr_email_templates_select on public.hr_email_templates;
create policy hr_email_templates_select on public.hr_email_templates
  for select using ((select public.hr_is_hr_staff()));

drop policy if exists hr_email_templates_insert on public.hr_email_templates;
create policy hr_email_templates_insert on public.hr_email_templates
  for insert with check (
    (select public.has_permission('hr.templates.write'))
    and created_by = (select auth.uid())
  );

drop policy if exists hr_email_templates_update on public.hr_email_templates;
create policy hr_email_templates_update on public.hr_email_templates
  for update using ((select public.has_permission('hr.templates.write')));

-- Messages about an application are read with the application. Messages to
-- employees (payslips, leave) are added with the employee tables.
drop policy if exists hr_email_messages_select on public.hr_email_messages;
create policy hr_email_messages_select on public.hr_email_messages
  for select using (
    hr_application_id is not null and public.hr_can_read_application(hr_application_id)
  );

-- ---------------------------------------------------------------------------
-- Magic links
-- ---------------------------------------------------------------------------

create table if not exists public.hr_access_tokens (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('application', 'reference', 'payslip')),
  hr_application_id uuid references public.hr_applications(id) on delete cascade,
  hr_reference_request_id uuid references public.hr_reference_requests(id) on delete cascade,
  hr_payslip_id uuid,
  token_hash text not null unique,
  expires_at timestamptz not null,
  max_uses int check (max_uses is null or max_uses > 0),
  use_count int not null default 0,
  revoked_at timestamptz,
  created_reason text,
  created_at timestamptz not null default now(),
  -- A token names exactly one subject, and its purpose decides which.
  constraint hr_access_tokens_subject_check check (
    (purpose = 'application' and hr_application_id is not null and hr_reference_request_id is null and hr_payslip_id is null)
    or (purpose = 'reference' and hr_reference_request_id is not null and hr_application_id is null and hr_payslip_id is null)
    or (purpose = 'payslip' and hr_payslip_id is not null and hr_application_id is null and hr_reference_request_id is null)
  )
);

create index if not exists hr_access_tokens_application_idx on public.hr_access_tokens (hr_application_id);
create index if not exists hr_access_tokens_reference_idx on public.hr_access_tokens (hr_reference_request_id);

comment on table public.hr_access_tokens is
  'HR magic links. Only the hash is stored; the raw token exists in the email and nowhere else.';

create table if not exists public.hr_token_uses (
  id bigint generated always as identity primary key,
  token_id uuid not null references public.hr_access_tokens(id) on delete cascade,
  used_at timestamptz not null default now(),
  ip_hash text,
  user_agent text,
  outcome text not null
);

create index if not exists hr_token_uses_token_idx on public.hr_token_uses (token_id, used_at desc);

create or replace function public.hr_consume_token(
  p_token_hash text,
  p_ip_hash text,
  p_user_agent text
)
returns table (
  outcome text,
  purpose text,
  hr_application_id uuid,
  hr_reference_request_id uuid,
  hr_payslip_id uuid,
  token_id uuid
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  t public.hr_access_tokens%rowtype;
  v_outcome text;
begin
  select * into t from public.hr_access_tokens where token_hash = p_token_hash for update;
  if not found then
    return query select 'unknown'::text, null::text, null::uuid, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  if t.revoked_at is not null then
    v_outcome := 'revoked';
  elsif t.expires_at < now() then
    v_outcome := 'expired';
  elsif t.max_uses is not null and t.use_count >= t.max_uses then
    v_outcome := 'exhausted';
  else
    v_outcome := 'ok';
    update public.hr_access_tokens set use_count = use_count + 1 where id = t.id;
  end if;

  insert into public.hr_token_uses (token_id, ip_hash, user_agent, outcome)
  values (t.id, p_ip_hash, left(p_user_agent, 300), v_outcome);

  return query select
    v_outcome,
    case when v_outcome = 'ok' then t.purpose end,
    case when v_outcome = 'ok' then t.hr_application_id end,
    case when v_outcome = 'ok' then t.hr_reference_request_id end,
    case when v_outcome = 'ok' then t.hr_payslip_id end,
    t.id;
end;
$$;

revoke execute on function public.hr_consume_token(text, text, text) from public, anon, authenticated;

alter table public.hr_access_tokens enable row level security;
alter table public.hr_token_uses enable row level security;

-- No policies at all: tokens are minted and consumed by the HR app under the
-- service role, and staff have no reason to read a hash.

-- ---------------------------------------------------------------------------
-- The templates
-- ---------------------------------------------------------------------------

insert into public.hr_email_templates (key, audience, name, description, subject, body_text, body_html, allowed_variables)
values
(
  'hr_application_continue', 'applicant',
  'Continue your application',
  'Sent when an applicant starts an application, and whenever they ask for a fresh link.',
  'Your application for {{vacancy_title}}',
  E'Dear {{applicant_first_name}},\n\nThank you for starting your application for {{vacancy_title}} at {{campus}}.\n\nUse this link to continue at any time. Your answers are saved as you go.\n{{link}}\n\nThe link is personal to you. Please do not share it. It works until {{link_expires_on}}.\n\nKind regards,\nHuman Resources\nHibiscus International Schools',
  '<p>Dear {{applicant_first_name}},</p><p>Thank you for starting your application for <strong>{{vacancy_title}}</strong> at <strong>{{campus}}</strong>.</p><p>Use this button to continue at any time. Your answers are saved as you go.</p><p><a href="{{link}}" class="button">Continue my application</a></p><p>The link is personal to you. Please do not share it. It works until {{link_expires_on}}.</p><p>Kind regards,<br>Human Resources<br>Hibiscus International Schools</p>',
  array['applicant_first_name', 'vacancy_title', 'campus', 'link', 'link_expires_on']
),
(
  'hr_application_received', 'applicant',
  'Application received',
  'Sent when an applicant submits.',
  'We have received your application for {{vacancy_title}}',
  E'Dear {{applicant_first_name}},\n\nThank you. We have received your application for {{vacancy_title}} at {{campus}}.\n\nYour reference is {{application_reference}}.\n\nWhat happens next:\n1. We email your referees today and ask them a few short questions.\n2. Our team reads every application after the closing date ({{closes_on}}).\n3. We email you with our decision. If you are shortlisted, we invite you to an interview.\n\nYou do not need to do anything now.\n\nKind regards,\nHuman Resources\nHibiscus International Schools',
  '<p>Dear {{applicant_first_name}},</p><p>Thank you. We have received your application for <strong>{{vacancy_title}}</strong> at <strong>{{campus}}</strong>.</p><p>Your reference is <strong>{{application_reference}}</strong>.</p><p>What happens next:</p><ol><li>We email your referees today and ask them a few short questions.</li><li>Our team reads every application after the closing date ({{closes_on}}).</li><li>We email you with our decision. If you are shortlisted, we invite you to an interview.</li></ol><p>You do not need to do anything now.</p><p>Kind regards,<br>Human Resources<br>Hibiscus International Schools</p>',
  array['applicant_first_name', 'vacancy_title', 'campus', 'application_reference', 'closes_on']
),
(
  'hr_draft_expiring', 'applicant',
  'Unfinished application reminder',
  'Sent once, a few days before an unfinished application is deleted.',
  'Your application for {{vacancy_title}} is not finished',
  E'Dear {{applicant_first_name}},\n\nYou started an application for {{vacancy_title}} at {{campus}}, but you have not sent it yet.\n\nYou can finish it here:\n{{link}}\n\nIf you do not send it by {{delete_on}}, we will delete it.\n\nKind regards,\nHuman Resources\nHibiscus International Schools',
  '<p>Dear {{applicant_first_name}},</p><p>You started an application for <strong>{{vacancy_title}}</strong> at <strong>{{campus}}</strong>, but you have not sent it yet.</p><p><a href="{{link}}" class="button">Finish my application</a></p><p>If you do not send it by {{delete_on}}, we will delete it.</p><p>Kind regards,<br>Human Resources<br>Hibiscus International Schools</p>',
  array['applicant_first_name', 'vacancy_title', 'campus', 'link', 'delete_on']
),
(
  'hr_shortlisted', 'applicant',
  'Shortlisted',
  'Sent when a person moves an application to Shortlisted.',
  'You are shortlisted for {{vacancy_title}}',
  E'Dear {{applicant_first_name}},\n\nGood news. You are on the shortlist for {{vacancy_title}} at {{campus}}.\n\nWe will email you soon with a date and time for your interview.\n\nKind regards,\nHuman Resources\nHibiscus International Schools',
  '<p>Dear {{applicant_first_name}},</p><p>Good news. You are on the shortlist for <strong>{{vacancy_title}}</strong> at <strong>{{campus}}</strong>.</p><p>We will email you soon with a date and time for your interview.</p><p>Kind regards,<br>Human Resources<br>Hibiscus International Schools</p>',
  array['applicant_first_name', 'vacancy_title', 'campus']
),
(
  'hr_interview_invite', 'applicant',
  'Interview invitation',
  'Sent when an interview is booked. A calendar invitation is attached.',
  'Your interview for {{vacancy_title}}: {{interview_when}}',
  E'Dear {{applicant_first_name}},\n\nWe would like to meet you for an interview for {{vacancy_title}}.\n\nWhen: {{interview_when}}\nHow: {{interview_mode}}\nWhere: {{interview_where}}\n\nThe interview takes about one hour. We may ask you to talk about some of the answers in your application.\n\nPlease bring your ID or passport and the originals of your certificates.\n\nIf you cannot come at this time, please reply to this email.\n\nKind regards,\nHuman Resources\nHibiscus International Schools',
  '<p>Dear {{applicant_first_name}},</p><p>We would like to meet you for an interview for <strong>{{vacancy_title}}</strong>.</p><table class="details"><tr><td>When</td><td><strong>{{interview_when}}</strong></td></tr><tr><td>How</td><td>{{interview_mode}}</td></tr><tr><td>Where</td><td>{{interview_where}}</td></tr></table><p>The interview takes about one hour. We may ask you to talk about some of the answers in your application.</p><p>Please bring your ID or passport and the originals of your certificates.</p><p>If you cannot come at this time, please reply to this email.</p><p>Kind regards,<br>Human Resources<br>Hibiscus International Schools</p>',
  array['applicant_first_name', 'vacancy_title', 'interview_when', 'interview_mode', 'interview_where']
),
(
  'hr_interview_changed', 'applicant',
  'Interview changed',
  'Sent when an interview is moved. The updated calendar invitation is attached.',
  'New time for your interview: {{interview_when}}',
  E'Dear {{applicant_first_name}},\n\nWe have changed the time of your interview for {{vacancy_title}}.\n\nNew time: {{interview_when}}\nHow: {{interview_mode}}\nWhere: {{interview_where}}\n\nIf you cannot come at this time, please reply to this email.\n\nKind regards,\nHuman Resources\nHibiscus International Schools',
  '<p>Dear {{applicant_first_name}},</p><p>We have changed the time of your interview for <strong>{{vacancy_title}}</strong>.</p><table class="details"><tr><td>New time</td><td><strong>{{interview_when}}</strong></td></tr><tr><td>How</td><td>{{interview_mode}}</td></tr><tr><td>Where</td><td>{{interview_where}}</td></tr></table><p>If you cannot come at this time, please reply to this email.</p><p>Kind regards,<br>Human Resources<br>Hibiscus International Schools</p>',
  array['applicant_first_name', 'vacancy_title', 'interview_when', 'interview_mode', 'interview_where']
),
(
  'hr_interview_cancelled', 'applicant',
  'Interview cancelled',
  'Sent when an interview is cancelled.',
  'Your interview for {{vacancy_title}} is cancelled',
  E'Dear {{applicant_first_name}},\n\nWe have cancelled your interview on {{interview_when}} for {{vacancy_title}}.\n\nWe will contact you again soon.\n\nKind regards,\nHuman Resources\nHibiscus International Schools',
  '<p>Dear {{applicant_first_name}},</p><p>We have cancelled your interview on {{interview_when}} for <strong>{{vacancy_title}}</strong>.</p><p>We will contact you again soon.</p><p>Kind regards,<br>Human Resources<br>Hibiscus International Schools</p>',
  array['applicant_first_name', 'vacancy_title', 'interview_when']
),
(
  'hr_unsuccessful', 'applicant',
  'Not successful',
  'Sent only when a person presses the button, never automatically.',
  'Your application for {{vacancy_title}}',
  E'Dear {{applicant_first_name}},\n\nThank you for applying for {{vacancy_title}} at {{campus}}, and for the time you gave to your application.\n\nWe received many strong applications. We are sorry to tell you that we will not take your application further this time.\n\n{{#if talent_pool}}You asked us to keep your details. We will contact you if a suitable post opens in the next two years.\n\n{{/if}}We wish you every success.\n\nKind regards,\nHuman Resources\nHibiscus International Schools',
  '<p>Dear {{applicant_first_name}},</p><p>Thank you for applying for <strong>{{vacancy_title}}</strong> at <strong>{{campus}}</strong>, and for the time you gave to your application.</p><p>We received many strong applications. We are sorry to tell you that we will not take your application further this time.</p>{{#if talent_pool}}<p>You asked us to keep your details. We will contact you if a suitable post opens in the next two years.</p>{{/if}}<p>We wish you every success.</p><p>Kind regards,<br>Human Resources<br>Hibiscus International Schools</p>',
  array['applicant_first_name', 'vacancy_title', 'campus', 'talent_pool']
),
(
  'hr_offer', 'applicant',
  'Offer',
  'Sent only when a person presses the button. The contract follows separately.',
  'An offer for {{vacancy_title}}',
  E'Dear {{applicant_first_name}},\n\nWe are pleased to offer you the post of {{vacancy_title}} at {{campus}}.\n\n{{#if offer_note}}{{offer_note}}\n\n{{/if}}Our team will contact you in the next few days with your contract and your starting date.\n\nWelcome to Hibiscus International Schools.\n\nKind regards,\nHuman Resources\nHibiscus International Schools',
  '<p>Dear {{applicant_first_name}},</p><p>We are pleased to offer you the post of <strong>{{vacancy_title}}</strong> at <strong>{{campus}}</strong>.</p>{{#if offer_note}}<p>{{offer_note}}</p>{{/if}}<p>Our team will contact you in the next few days with your contract and your starting date.</p><p>Welcome to Hibiscus International Schools.</p><p>Kind regards,<br>Human Resources<br>Hibiscus International Schools</p>',
  array['applicant_first_name', 'vacancy_title', 'campus', 'offer_note']
),
(
  'hr_withdrawal_confirmed', 'applicant',
  'Withdrawal confirmed',
  'Sent when an applicant withdraws.',
  'You have withdrawn your application',
  E'Dear {{applicant_first_name}},\n\nYou have withdrawn your application for {{vacancy_title}}. We will not contact your referees again.\n\nThank you for your interest in Hibiscus International Schools.\n\nKind regards,\nHuman Resources\nHibiscus International Schools',
  '<p>Dear {{applicant_first_name}},</p><p>You have withdrawn your application for <strong>{{vacancy_title}}</strong>. We will not contact your referees again.</p><p>Thank you for your interest in Hibiscus International Schools.</p><p>Kind regards,<br>Human Resources<br>Hibiscus International Schools</p>',
  array['applicant_first_name', 'vacancy_title']
),
(
  'hr_reference_request', 'referee',
  'Reference request',
  'Sent to each referee when the applicant submits.',
  'A reference for {{applicant_full_name}}',
  E'Dear {{referee_name}},\n\n{{applicant_full_name}} has applied for the post of {{vacancy_title}} at Hibiscus International Schools. They gave your name as a referee.\n\nPlease answer a few short questions about them. It takes about four minutes:\n{{link}}\n\nYour answers go only to our Human Resources team. The applicant does not see them.\n\nThe link works until {{expires_on}}. If you cannot give a reference, you can say so on the same page.\n\nThank you for your help.\n\nKind regards,\nHuman Resources\nHibiscus International Schools',
  '<p>Dear {{referee_name}},</p><p><strong>{{applicant_full_name}}</strong> has applied for the post of <strong>{{vacancy_title}}</strong> at Hibiscus International Schools. They gave your name as a referee.</p><p>Please answer a few short questions about them. It takes about four minutes.</p><p><a href="{{link}}" class="button">Give a reference</a></p><p>Your answers go only to our Human Resources team. The applicant does not see them.</p><p>The link works until {{expires_on}}. If you cannot give a reference, you can say so on the same page.</p><p>Thank you for your help.</p><p>Kind regards,<br>Human Resources<br>Hibiscus International Schools</p>',
  array['referee_name', 'applicant_full_name', 'vacancy_title', 'link', 'expires_on']
),
(
  'hr_reference_reminder', 'referee',
  'Reference reminder',
  'Sent a few days after the request when no reference has arrived.',
  'Reminder: a reference for {{applicant_full_name}}',
  E'Dear {{referee_name}},\n\nA few days ago we asked you for a reference for {{applicant_full_name}}, who has applied for {{vacancy_title}}.\n\nIf you have a moment, please answer here. It takes about four minutes:\n{{link}}\n\nThe link works until {{expires_on}}.\n\nThank you.\n\nKind regards,\nHuman Resources\nHibiscus International Schools',
  '<p>Dear {{referee_name}},</p><p>A few days ago we asked you for a reference for <strong>{{applicant_full_name}}</strong>, who has applied for <strong>{{vacancy_title}}</strong>.</p><p>If you have a moment, please answer here. It takes about four minutes.</p><p><a href="{{link}}" class="button">Give a reference</a></p><p>The link works until {{expires_on}}.</p><p>Thank you.</p><p>Kind regards,<br>Human Resources<br>Hibiscus International Schools</p>',
  array['referee_name', 'applicant_full_name', 'vacancy_title', 'link', 'expires_on']
),
(
  'hr_reference_final_reminder', 'referee',
  'Reference: last reminder',
  'Sent once more, a week after the request.',
  'Last reminder: a reference for {{applicant_full_name}}',
  E'Dear {{referee_name}},\n\nThis is our last reminder about a reference for {{applicant_full_name}}. Their application cannot move forward without it.\n\n{{link}}\n\nThe link closes on {{expires_on}}. If you cannot give a reference, please tell us on the same page.\n\nThank you.\n\nKind regards,\nHuman Resources\nHibiscus International Schools',
  '<p>Dear {{referee_name}},</p><p>This is our last reminder about a reference for <strong>{{applicant_full_name}}</strong>. Their application cannot move forward without it.</p><p><a href="{{link}}" class="button">Give a reference</a></p><p>The link closes on {{expires_on}}. If you cannot give a reference, please tell us on the same page.</p><p>Thank you.</p><p>Kind regards,<br>Human Resources<br>Hibiscus International Schools</p>',
  array['referee_name', 'applicant_full_name', 'link', 'expires_on']
),
(
  'hr_reference_thank_you', 'referee',
  'Reference thank you',
  'Sent when a referee submits.',
  'Thank you for your reference',
  E'Dear {{referee_name}},\n\nThank you for your reference for {{applicant_full_name}}. We have received it.\n\nKind regards,\nHuman Resources\nHibiscus International Schools',
  '<p>Dear {{referee_name}},</p><p>Thank you for your reference for <strong>{{applicant_full_name}}</strong>. We have received it.</p><p>Kind regards,<br>Human Resources<br>Hibiscus International Schools</p>',
  array['referee_name', 'applicant_full_name']
),
(
  'hr_staff_reference_concern', 'staff',
  'A referee raised a concern',
  'Sent at once to the HR managers when a referee answers yes to the safeguarding question.',
  'A referee raised a concern: {{application_reference}}',
  E'A referee has raised a concern about an applicant for {{vacancy_title}} at {{campus}}.\n\nApplication: {{application_reference}}\n\nPlease read the reference before you take the application further:\n{{staff_link}}\n\nThis email does not repeat what the referee wrote. Read it in the HR app.',
  '<p>A referee has raised a concern about an applicant for <strong>{{vacancy_title}}</strong> at <strong>{{campus}}</strong>.</p><p>Application: <strong>{{application_reference}}</strong></p><p>Please read the reference before you take the application further.</p><p><a href="{{staff_link}}" class="button">Open the application</a></p><p>This email does not repeat what the referee wrote. Read it in the HR app.</p>',
  array['application_reference', 'vacancy_title', 'campus', 'staff_link']
),
(
  'hr_staff_references_complete', 'staff',
  'All references received',
  'Sent to the HR team when the last reference for an application arrives.',
  'All references are in: {{application_reference}}',
  E'All references for {{applicant_full_name}} ({{application_reference}}) are in.\n\nVacancy: {{vacancy_title}}\n\n{{staff_link}}',
  '<p>All references for <strong>{{applicant_full_name}}</strong> ({{application_reference}}) are in.</p><p>Vacancy: {{vacancy_title}}</p><p><a href="{{staff_link}}" class="button">Open the application</a></p>',
  array['applicant_full_name', 'application_reference', 'vacancy_title', 'staff_link']
),
(
  'hr_staff_reference_expired', 'staff',
  'A reference did not arrive',
  'Sent when a reference link closes without an answer.',
  'No reference from {{referee_name}}: {{application_reference}}',
  E'{{referee_name}} did not give a reference for {{applicant_full_name}} ({{application_reference}}) before the link closed.\n\nYou may want to ask the applicant for another referee.\n\n{{staff_link}}',
  '<p><strong>{{referee_name}}</strong> did not give a reference for <strong>{{applicant_full_name}}</strong> ({{application_reference}}) before the link closed.</p><p>You may want to ask the applicant for another referee.</p><p><a href="{{staff_link}}" class="button">Open the application</a></p>',
  array['referee_name', 'applicant_full_name', 'application_reference', 'staff_link']
)
on conflict (key, version) do nothing;
