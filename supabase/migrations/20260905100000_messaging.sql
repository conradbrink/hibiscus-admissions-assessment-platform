-- WhatsApp as a companion channel.
--
-- The email pipeline stays the source of truth for what is said and when.
-- A WhatsApp message is a second delivery of the same moment, sent only to
-- a parent who asked for it, and always as a template the school had
-- approved with Meta beforehand — free text is never sent. Every message,
-- both directions, is recorded here with the text the parent saw.
--
-- Nothing in this file names a provider: the rows describe a template and a
-- message; which adapter delivers them is an environment variable.

-- ---------------------------------------------------------------------------
-- Opt-in lives on the contact: it is the person's choice, not the child's
-- ---------------------------------------------------------------------------

alter table public.contacts
  add column if not exists whatsapp_opt_in boolean not null default false,
  add column if not exists whatsapp_opt_in_at timestamptz,
  add column if not exists whatsapp_opt_out_at timestamptz,
  add column if not exists whatsapp_opt_in_source text
    check (whatsapp_opt_in_source is null or whatsapp_opt_in_source in ('enquiry', 'registration', 'staff', 'reply'));

comment on column public.contacts.whatsapp_opt_in is
  'The parent asked for WhatsApp updates on this number. False until they tick the box; a STOP reply clears it.';

-- ---------------------------------------------------------------------------
-- Message templates: our variables mapped onto an approved Meta template
-- ---------------------------------------------------------------------------

create table if not exists public.message_templates (
  -- The email template key this message accompanies: the same moment.
  key text primary key check (key ~ '^[a-z0-9_]+$'),
  name text not null,
  -- The template's name as approved in Meta Business Manager. Null until
  -- the school has one; the row cannot be activated without it.
  meta_template_name text check (meta_template_name is null or meta_template_name ~ '^[a-z0-9_]+$'),
  language text not null default 'en',
  -- The approved wording with {{1}}…{{n}} placeholders, kept so the editor
  -- can preview it and the record can show what the parent read.
  body_preview text not null default '',
  -- Our variable names, in order, filling {{1}}…{{n}}. A subset of the
  -- email template's allowed_variables, never a link.
  parameters text[] not null default '{}'::text[],
  -- The template has a dynamic-URL button whose suffix is a magic link token.
  button_link boolean not null default false,
  link_purpose text not null default 'next_step'
    check (link_purpose in ('next_step', 'results', 'offer', 'payment', 'registration')),
  is_active boolean not null default false,
  updated_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not is_active or meta_template_name is not null)
);

drop trigger if exists message_templates_set_updated_at on public.message_templates;
create trigger message_templates_set_updated_at
  before update on public.message_templates
  for each row execute function public.set_updated_at();

comment on table public.message_templates is
  'One row per email moment that may also go by WhatsApp. Inactive until the school has the Meta-approved template and names it here.';

-- The moments worth a phone notification. All inactive: activation is the
-- school's, once each template is approved by Meta.
insert into public.message_templates (key, name, body_preview, parameters, button_link, link_purpose)
values
  ('booking_confirmed', 'Assessment booked',
   E'Hi {{1}}, {{2}}''s assessment at {{3}} is booked for {{4}} at {{5}}. Reference {{6}}. Tap below to see the details.',
   array['parent_first_name','student_first_name','campus','assessment_date','assessment_time','application_reference'], true, 'next_step'),
  ('assessment_reminder_48h', 'Assessment in two days',
   E'Hi {{1}}, a reminder that {{2}}''s assessment at {{3}} is on {{4}} at {{5}}.',
   array['parent_first_name','student_first_name','campus','assessment_date','assessment_time'], true, 'next_step'),
  ('assessment_reminder_day', 'Assessment today',
   E'Hi {{1}}, {{2}}''s assessment is today at {{3}}, {{4}}. See you there.',
   array['parent_first_name','student_first_name','assessment_time','campus'], true, 'next_step'),
  ('no_show_reschedule', 'Missed assessment',
   E'Hi {{1}}, we missed {{2}} today. Tap below to choose a new date and time.',
   array['parent_first_name','student_first_name'], true, 'next_step'),
  ('results_and_offer', 'Results and offer ready',
   E'Hi {{1}}, {{2}}''s assessment results and an offer of a place at {{3}} are ready. Tap below to read them.',
   array['parent_first_name','student_first_name','campus'], true, 'offer'),
  ('offer_reminder', 'Offer expiring',
   E'Hi {{1}}, the offer of a place for {{2}} at {{3}} expires on {{4}}. Tap below to accept it.',
   array['parent_first_name','student_first_name','campus','offer_expiry_date'], true, 'offer'),
  ('payment_reminder', 'Fees due',
   E'Hi {{1}}, {{2}} is due for {{3}}''s place by {{4}}. Tap below to pay securely.',
   array['parent_first_name','amount_due','student_first_name','payment_due_date'], true, 'payment'),
  ('payment_failed', 'Payment not completed',
   E'Hi {{1}}, the payment for {{2}}''s place did not go through. Tap below to try again or see the bank details.',
   array['parent_first_name','student_first_name'], true, 'payment'),
  ('registration_reminder', 'Registration to finish',
   E'Hi {{1}}, {{2}}''s registration is not finished yet. Tap below to continue where you left off.',
   array['parent_first_name','student_first_name'], true, 'registration'),
  ('documents_missing', 'Documents needed',
   E'Hi {{1}}, we still need: {{2}}. Tap below to upload them.',
   array['parent_first_name','missing_documents'], true, 'registration'),
  ('welcome_enrolled', 'Welcome',
   E'Hi {{1}}, {{2}} is enrolled at {{3}} in {{4}}, starting {{5}}. Welcome to Hibiscus Schools.',
   array['parent_first_name','student_first_name','campus','grade','start_date'], false, 'next_step')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Messages: every WhatsApp message, both directions
-- ---------------------------------------------------------------------------

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  direction text not null check (direction in ('out', 'in')),
  channel text not null default 'whatsapp' check (channel in ('whatsapp')),
  template_key text,
  -- E.164 for both; outbound has to_, inbound has from_.
  to_normalised text,
  from_normalised text,
  provider text not null,
  provider_message_id text,
  status text not null default 'queued' check (status in (
    'queued', 'sent', 'delivered', 'read', 'failed', 'skipped', 'received'
  )),
  -- What the parent saw or wrote. Inbound text is truncated on the way in.
  rendered_text text not null default '',
  error text,
  -- One send per moment, however many times the job is retried.
  idempotency_key text unique,
  -- The email this message accompanied, when it did.
  email_message_id uuid references public.email_messages(id) on delete set null,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists messages_set_updated_at on public.messages;
create trigger messages_set_updated_at
  before update on public.messages
  for each row execute function public.set_updated_at();

create index if not exists messages_application_idx on public.messages(application_id, created_at desc);
create unique index if not exists messages_provider_id_idx
  on public.messages(provider_message_id)
  where provider_message_id is not null;
create index if not exists messages_created_idx on public.messages(created_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.message_templates enable row level security;
alter table public.messages enable row level security;

drop policy if exists message_templates_select on public.message_templates;
create policy message_templates_select on public.message_templates
  for select using ((select public.current_staff_id()) is not null);
drop policy if exists message_templates_write on public.message_templates;
create policy message_templates_write on public.message_templates
  for all using ((select public.has_permission('templates.write')))
  with check ((select public.has_permission('templates.write')));

-- Messages are visible with the application, like emails. Sending goes
-- through the job drain; no staff write.
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select using (
    exists (
      select 1 from public.applications a
      where a.id = messages.application_id
        and (select public.has_permission('applications.read'))
        and (select public.can_access_campus(a.campus_id))
    )
  );

-- ---------------------------------------------------------------------------
-- The switch
-- ---------------------------------------------------------------------------

insert into public.settings (key, value, description)
values
  ('whatsapp_enabled', 'false'::jsonb,
   'Send a WhatsApp message beside each email for parents who opted in, using the active message templates. Needs the messaging provider configured.')
on conflict (key) do nothing;
