-- Offer acceptance and payment.
--
-- The parent accepts the offer electronically (an immutable, audit-grade
-- record of exactly what was accepted), which raises a payment request for
-- the fees payable on acceptance. Payments are attempts and receipts against
-- that request: an online checkout through the gateway, or a bank transfer
-- finance records. Nothing here becomes "paid" on a parent's say-so — only
-- on a server-side verification whose amount and currency match ours, or on
-- a receipt a person recorded and is accountable for.
--
-- No card data is stored anywhere. The gateway hosts the payment page;
-- what comes back is a reference and a result.

-- ---------------------------------------------------------------------------
-- Acceptances: one per offer, never edited
-- ---------------------------------------------------------------------------

create table if not exists public.offer_acceptances (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  offer_id uuid not null references public.offers(id) on delete restrict unique,
  -- The offer version, copied so the record stands on its own.
  template_id uuid not null references public.offer_templates(id) on delete restrict,
  template_version int not null,
  decision text not null check (decision in ('accepted', 'declined')),
  terms_accepted boolean not null default false,
  -- sha256 (base64url) over the rendered offer, its terms and its fees at
  -- the moment of the decision: proof of what was on the screen.
  terms_hash text not null,
  fees jsonb not null default '{}'::jsonb,
  decline_reason text,
  ip_hash text,
  user_agent text,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (decision <> 'accepted' or terms_accepted)
);

create index if not exists offer_acceptances_application_idx on public.offer_acceptances(application_id);

-- The one-live index on offers excludes 'accepted' on purpose: an accepted
-- offer leads only to payment_required, so no second offer can be drafted
-- beside it; nothing to change.
comment on index public.offers_one_live_per_application_idx is
  'One offer in flight per application. accepted is not "in flight": the application has moved to payment and cannot draft another.';

-- ---------------------------------------------------------------------------
-- Payment requests: what is owed after acceptance
-- ---------------------------------------------------------------------------

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  offer_id uuid not null references public.offers(id) on delete restrict,
  acceptance_id uuid not null references public.offer_acceptances(id) on delete restrict,
  currency text not null check (currency in ('BWP', 'ZAR')),
  -- The fees payable on acceptance, from the accepted offer's snapshot.
  amount_minor bigint not null check (amount_minor > 0),
  -- [{code, label, amount_minor}] — the payable lines, for the page and the receipt.
  lines jsonb not null default '[]'::jsonb,
  paid_minor bigint not null default 0 check (paid_minor >= 0),
  status text not null default 'required' check (status in (
    'required', 'processing', 'paid', 'failed', 'refunded', 'partially_paid', 'cancelled'
  )),
  due_at timestamptz not null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists payment_requests_set_updated_at on public.payment_requests;
create trigger payment_requests_set_updated_at
  before update on public.payment_requests
  for each row execute function public.set_updated_at();

create unique index if not exists payment_requests_one_open_idx
  on public.payment_requests(application_id)
  where status in ('required', 'processing', 'failed', 'partially_paid');

create index if not exists payment_requests_status_idx on public.payment_requests(status, due_at);

-- ---------------------------------------------------------------------------
-- Payments: one row per attempt or receipt
-- ---------------------------------------------------------------------------

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null references public.payment_requests(id) on delete cascade,
  -- Denormalised so the policy is one join, like every applicant table.
  application_id uuid not null references public.applications(id) on delete cascade,
  method text not null check (method in ('online', 'eft')),
  provider text not null check (provider in ('dev', 'dpo', 'bank')),
  -- The gateway's transaction token, or a dev_ reference. Unique: a token
  -- verifies one payment, never two.
  provider_ref text,
  -- Our reference as sent to the gateway and shown to the parent: the
  -- application reference plus a short payment id.
  company_ref text not null,
  status text not null default 'pending' check (status in (
    'pending', 'processing', 'succeeded', 'failed', 'expired', 'refunded'
  )),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency in ('BWP', 'ZAR')),
  approval_code text,
  -- The checkout's payment time limit. A processing payment past this is
  -- expired by the reconciler, not by the parent's browser.
  expires_at timestamptz,
  verify_attempts int not null default 0,
  last_verified_at timestamptz,
  -- The parsed verification response: result code, explanation, approval,
  -- amount, currency, customer name. An allow-list, never the raw body.
  raw_response jsonb,
  failure_reason text,
  -- Bank transfer (recorded by finance)
  bank_reference text,
  received_on date,
  recorded_by uuid references public.staff_profiles(id) on delete set null,
  note text,
  -- Refund (recorded by finance; the money moves at the bank or gateway)
  refunded_at timestamptz,
  refunded_by uuid references public.staff_profiles(id) on delete set null,
  refund_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

create unique index if not exists payments_provider_ref_idx on public.payments(provider_ref) where provider_ref is not null;
create index if not exists payments_request_idx on public.payments(payment_request_id);
create index if not exists payments_processing_idx on public.payments(last_verified_at) where status = 'processing';

-- ---------------------------------------------------------------------------
-- Bank instructions: what a parent paying by transfer needs to know.
-- Configuration, not code: per currency, optionally per campus; the most
-- specific active row wins. Plain text, rendered as lines.
-- ---------------------------------------------------------------------------

create table if not exists public.bank_instructions (
  id uuid primary key default gen_random_uuid(),
  currency text not null check (currency in ('BWP', 'ZAR')),
  campus_id uuid references public.campuses(id) on delete cascade,
  body_text text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists bank_instructions_set_updated_at on public.bank_instructions;
create trigger bank_instructions_set_updated_at
  before update on public.bank_instructions
  for each row execute function public.set_updated_at();

create unique index if not exists bank_instructions_one_active_idx
  on public.bank_instructions(currency, coalesce(campus_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where is_active;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.offer_acceptances enable row level security;
alter table public.payment_requests enable row level security;
alter table public.payments enable row level security;
alter table public.bank_instructions enable row level security;

-- Acceptances are written by the engine on the parent's click. Staff read
-- them with the offer they belong to. No staff write.
drop policy if exists offer_acceptances_select on public.offer_acceptances;
create policy offer_acceptances_select on public.offer_acceptances
  for select using (
    exists (
      select 1 from public.applications a
      where a.id = offer_acceptances.application_id
        and (select public.has_permission('offers.read'))
        and (select public.can_access_campus(a.campus_id))
    )
  );

-- What is owed is visible to whoever sees offers or payments. No staff write:
-- requests are raised by acceptance and settled by verified payments.
drop policy if exists payment_requests_select on public.payment_requests;
create policy payment_requests_select on public.payment_requests
  for select using (
    exists (
      select 1 from public.applications a
      where a.id = payment_requests.application_id
        and ((select public.has_permission('offers.read')) or (select public.has_permission('finance.read')))
        and (select public.can_access_campus(a.campus_id))
    )
  );

-- Receipts and attempts are finance's. No staff write: a bank transfer is
-- recorded through the engine so the audit trail and the application move
-- together.
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select using (
    exists (
      select 1 from public.applications a
      where a.id = payments.application_id
        and (select public.has_permission('finance.read'))
        and (select public.can_access_campus(a.campus_id))
    )
  );

drop policy if exists bank_instructions_select on public.bank_instructions;
create policy bank_instructions_select on public.bank_instructions
  for select using ((select public.current_staff_id()) is not null);
drop policy if exists bank_instructions_write on public.bank_instructions;
create policy bank_instructions_write on public.bank_instructions
  for all using ((select public.has_permission('finance.write')))
  with check ((select public.has_permission('finance.write')));

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

insert into public.settings (key, value, description) values
  ('payment_due_days',            '14',     'Days after accepting the offer by which the registration and admission fees are due.'),
  ('payment_reminder_days_before','[7, 2]', 'Days before the payment due date at which reminders are sent.'),
  ('payment_verify_minutes',      '10',     'How often a payment the gateway has not confirmed is re-checked.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Email templates. Wording is the school's to change in the editor; the
-- variable sets are fixed here.
-- ---------------------------------------------------------------------------

insert into public.email_templates (key, name, description, subject, body_text, body_html, allowed_variables)
values
(
  'offer_accepted_pay',
  'Offer accepted — fees due',
  'Sent the moment the parent accepts the offer. Says what is due, by when, and how to pay.',
  'Thank you for accepting — {{student_first_name}}''s place at {{campus}}',
  E'Dear {{parent_first_name}},\n\nThank you for accepting the offer of a place for {{student_first_name}} at {{campus}} in {{grade}}.\n\nTo secure the place, the registration and admission fees of {{amount_due}} are due by {{payment_due_date}}.\n\nPay securely online here:\n{{payment_link}}\n{{#if bank_details}}\nOr pay by bank transfer:\n{{bank_details}}\nPlease use the reference {{application_reference}} so we can match your payment.\n{{/if}}\nOnce we have your payment, we will send a receipt and a link to complete registration.\n\nReference: {{application_reference}}\n\nWarm regards,\nHibiscus Schools Admissions',
  '<p>Dear {{parent_first_name}},</p><p>Thank you for accepting the offer of a place for <strong>{{student_first_name}}</strong> at <strong>{{campus}}</strong> in <strong>{{grade}}</strong>.</p><p>To secure the place, the registration and admission fees of <strong>{{amount_due}}</strong> are due by <strong>{{payment_due_date}}</strong>.</p><p><a href="{{payment_link}}" class="button">Pay securely online</a></p>{{#if bank_details}}<p>Or pay by bank transfer:</p><p style="white-space:pre-line">{{bank_details}}</p><p>Please use the reference <strong>{{application_reference}}</strong> so we can match your payment.</p>{{/if}}<p>Once we have your payment, we will send a receipt and a link to complete registration.</p><p>Reference: {{application_reference}}</p><p>Warm regards,<br>Hibiscus Schools Admissions</p>',
  array['parent_first_name','student_first_name','campus','grade','application_reference','amount_due','payment_due_date','payment_link','bank_details','next_step_link']
),
(
  'payment_reminder',
  'Payment reminder',
  'Sent before the payment due date while the fees are outstanding.',
  'Reminder: {{student_first_name}}''s fees are due by {{payment_due_date}}',
  E'Dear {{parent_first_name}},\n\nA reminder that the registration and admission fees of {{amount_due}} for {{student_first_name}}''s place at {{campus}} are due by {{payment_due_date}}.\n\nPay securely online here:\n{{payment_link}}\n{{#if bank_details}}\nOr pay by bank transfer:\n{{bank_details}}\nPlease use the reference {{application_reference}}.\n{{/if}}\nIf you have already paid by bank transfer, please ignore this email; we will confirm as soon as the payment reaches us.\n\nReference: {{application_reference}}\n\nHibiscus Schools Admissions',
  '<p>Dear {{parent_first_name}},</p><p>A reminder that the registration and admission fees of <strong>{{amount_due}}</strong> for {{student_first_name}}''s place at {{campus}} are due by <strong>{{payment_due_date}}</strong>.</p><p><a href="{{payment_link}}" class="button">Pay securely online</a></p>{{#if bank_details}}<p>Or pay by bank transfer:</p><p style="white-space:pre-line">{{bank_details}}</p><p>Please use the reference <strong>{{application_reference}}</strong>.</p>{{/if}}<p>If you have already paid by bank transfer, please ignore this email; we will confirm as soon as the payment reaches us.</p><p>Reference: {{application_reference}}</p><p>Hibiscus Schools Admissions</p>',
  array['parent_first_name','student_first_name','campus','grade','application_reference','amount_due','payment_due_date','payment_link','bank_details','next_step_link']
),
(
  'payment_failed',
  'Payment not completed',
  'Sent when an online payment is declined, cancelled or times out. Invites the parent to try again.',
  'Your payment for {{student_first_name}}''s place was not completed',
  E'Dear {{parent_first_name}},\n\nThe online payment for {{student_first_name}}''s place at {{campus}} was not completed, so the fees of {{amount_due}} are still due by {{payment_due_date}}.\n\nYou can try again here:\n{{payment_link}}\n{{#if bank_details}}\nOr pay by bank transfer:\n{{bank_details}}\nPlease use the reference {{application_reference}}.\n{{/if}}\nIf you believe you were charged, please contact the admissions office with your reference and we will check with the payment provider.\n\nReference: {{application_reference}}\n\nHibiscus Schools Admissions',
  '<p>Dear {{parent_first_name}},</p><p>The online payment for {{student_first_name}}''s place at {{campus}} was not completed, so the fees of <strong>{{amount_due}}</strong> are still due by <strong>{{payment_due_date}}</strong>.</p><p><a href="{{payment_link}}" class="button">Try again</a></p>{{#if bank_details}}<p>Or pay by bank transfer:</p><p style="white-space:pre-line">{{bank_details}}</p><p>Please use the reference <strong>{{application_reference}}</strong>.</p>{{/if}}<p>If you believe you were charged, please contact the admissions office with your reference and we will check with the payment provider.</p><p>Reference: {{application_reference}}</p><p>Hibiscus Schools Admissions</p>',
  array['parent_first_name','student_first_name','campus','grade','application_reference','amount_due','payment_due_date','payment_link','bank_details','next_step_link']
),
(
  'payment_received',
  'Payment received — complete registration',
  'Sent when a payment is confirmed. Carries the receipt and the link to the registration form.',
  'Payment received — {{student_first_name}}''s place at {{campus}} is secured',
  E'Dear {{parent_first_name}},\n\nThank you. We have received your payment of {{amount_paid}} ({{payment_reference}}, {{payment_date}}) and {{student_first_name}}''s place at {{campus}} in {{grade}} is secured. Your receipt is attached.\n\nThe last step is registration: the details the school needs before {{student_first_name}} starts. We already have what you told us earlier, so it is shorter than it looks.\n\nComplete registration here:\n{{registration_link}}\n\nReference: {{application_reference}}\n\nWarm regards,\nHibiscus Schools Admissions',
  '<p>Dear {{parent_first_name}},</p><p>Thank you. We have received your payment of <strong>{{amount_paid}}</strong> ({{payment_reference}}, {{payment_date}}) and <strong>{{student_first_name}}</strong>''s place at {{campus}} in {{grade}} is secured. Your receipt is attached.</p><p>The last step is registration: the details the school needs before {{student_first_name}} starts. We already have what you told us earlier, so it is shorter than it looks.</p><p><a href="{{registration_link}}" class="button">Complete registration</a></p><p>Reference: {{application_reference}}</p><p>Warm regards,<br>Hibiscus Schools Admissions</p>',
  array['parent_first_name','student_first_name','campus','grade','application_reference','amount_paid','payment_reference','payment_date','registration_link','next_step_link']
)
on conflict (key, version) do nothing;
