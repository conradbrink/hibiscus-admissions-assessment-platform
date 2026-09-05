-- Fees, offer templates, and offers.
--
-- An offer is generated, never typed: the active template is rendered
-- against the application, the intake and the active fee schedule, and the
-- result is stored as a snapshot — the HTML, the variables, the fee lines.
-- The parent reads (and in Phase 3 accepts) a specific, immutable document;
-- a fee change next week cannot retroactively change what was offered.
--
-- Currency is per campus. A fee schedule's currency must be its campus's,
-- and an offer carries the currency it was made in.

-- ---------------------------------------------------------------------------
-- Fee schedules
-- ---------------------------------------------------------------------------

create table if not exists public.fee_schedules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  campus_id uuid not null references public.campuses(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  -- Null on both: every grade at the campus. A narrower band wins.
  grade_sort_min int,
  grade_sort_max int,
  currency text not null check (currency in ('BWP', 'ZAR')),
  status text not null default 'draft' check (status in ('draft', 'active')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (grade_sort_min is null or grade_sort_max is null or grade_sort_max >= grade_sort_min)
);

drop trigger if exists fee_schedules_set_updated_at on public.fee_schedules;
create trigger fee_schedules_set_updated_at
  before update on public.fee_schedules
  for each row execute function public.set_updated_at();

-- The schedule's currency is its campus's. Set here so a form cannot get it
-- wrong.
create or replace function public.fee_schedules_set_currency()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  select currency into new.currency from public.campuses where id = new.campus_id;
  return new;
end;
$$;

revoke all on function public.fee_schedules_set_currency() from public, anon, authenticated;

drop trigger if exists fee_schedules_set_currency on public.fee_schedules;
create trigger fee_schedules_set_currency
  before insert or update of campus_id on public.fee_schedules
  for each row execute function public.fee_schedules_set_currency();

create index if not exists fee_schedules_lookup_idx
  on public.fee_schedules(campus_id, academic_year_id)
  where status = 'active';

create table if not exists public.fee_lines (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.fee_schedules(id) on delete cascade,
  code text not null check (code in ('registration', 'admission', 'tuition_annual', 'tuition_term')),
  label text not null,
  amount_minor bigint not null check (amount_minor >= 0),
  -- What the parent pays to secure the place. Registration and admission
  -- fees by default; tuition is billed by the school afterwards.
  payable_at_acceptance boolean not null default false,
  position int not null default 0,
  unique (schedule_id, code)
);

-- ---------------------------------------------------------------------------
-- Offer templates
-- ---------------------------------------------------------------------------

-- Same shape and rules as email_templates: versioned, one active per key,
-- allow-listed variables decided in migrations, wording decided by staff.
create table if not exists public.offer_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  version int not null default 1,
  name text not null,
  description text,
  body_html text not null,
  terms_html text not null,
  allowed_variables text[] not null default '{}'::text[],
  is_active boolean not null default true,
  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (key, version)
);

drop trigger if exists offer_templates_set_updated_at on public.offer_templates;
create trigger offer_templates_set_updated_at
  before update on public.offer_templates
  for each row execute function public.set_updated_at();

create unique index if not exists offer_templates_one_active_idx
  on public.offer_templates(key)
  where is_active;

create or replace function public.publish_offer_template(
  p_key text,
  p_name text,
  p_description text,
  p_body_html text,
  p_terms_html text
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_allowed text[];
  v_next int;
  v_id uuid;
begin
  if not public.has_permission('templates.write') then
    raise exception 'permission_denied';
  end if;
  select allowed_variables, max(version) + 1
    into v_allowed, v_next
    from public.offer_templates
   where key = p_key
   group by allowed_variables
   order by max(version) desc
   limit 1;
  if v_next is null then
    raise exception 'template_key_unknown';
  end if;
  update public.offer_templates set is_active = false where key = p_key and is_active;
  insert into public.offer_templates (key, version, name, description, body_html, terms_html, allowed_variables, is_active, created_by)
  values (p_key, v_next, p_name, p_description, p_body_html, p_terms_html, v_allowed, true, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.publish_offer_template(text, text, text, text, text) from public, anon;
grant execute on function public.publish_offer_template(text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Offers
-- ---------------------------------------------------------------------------

create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  template_id uuid not null references public.offer_templates(id) on delete restrict,
  template_version int not null,
  fee_schedule_id uuid references public.fee_schedules(id) on delete set null,
  currency text not null check (currency in ('BWP', 'ZAR')),
  -- The variables the template was rendered with, and the result.
  variables jsonb not null default '{}'::jsonb,
  rendered_html text not null,
  terms_html text not null,
  -- {lines: [{code, label, amount_minor, payable_at_acceptance}], total_minor, payable_at_acceptance_minor}
  fees jsonb not null default '{}'::jsonb,
  start_date date,
  expires_at timestamptz,
  -- accepted/declined are reached in Phase 3; listed now so that phase adds
  -- code, not a constraint change.
  status text not null default 'draft' check (status in (
    'draft', 'pending_approval', 'sent', 'viewed', 'expired', 'withdrawn', 'accepted', 'declined'
  )),
  approved_by uuid references public.staff_profiles(id) on delete set null,
  approved_at timestamptz,
  sent_at timestamptz,
  first_viewed_at timestamptz,
  conditions text,
  withdrawn_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists offers_set_updated_at on public.offers;
create trigger offers_set_updated_at
  before update on public.offers
  for each row execute function public.set_updated_at();

-- One live offer per application.
create unique index if not exists offers_one_live_per_application_idx
  on public.offers(application_id)
  where status in ('draft', 'pending_approval', 'sent', 'viewed');

create index if not exists offers_status_idx on public.offers(status, expires_at);

-- ---------------------------------------------------------------------------
-- Dashboard counts, redefined for Phase 2
-- ---------------------------------------------------------------------------

create or replace function public.dashboard_counts()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with today as (
    select (now() at time zone 'Africa/Gaborone')::date as d
  )
  select jsonb_build_object(
    'new_enquiries',
      (select count(*) from public.applications where status in ('new_enquiry', 'callback_requested')),
    'callbacks_open',
      (select count(*) from public.tasks where status = 'open' and type = 'callback'),
    'assessments_today',
      (select count(*)
         from public.bookings b
         join public.sessions s on s.id = b.session_id
        where b.kind = 'assessment'
          and b.status in ('booked', 'checked_in', 'in_progress', 'completed')
          and (s.starts_at at time zone 'Africa/Gaborone')::date = (select d from today)),
    'assessments_this_week',
      (select count(*)
         from public.bookings b
         join public.sessions s on s.id = b.session_id
        where b.kind = 'assessment'
          and b.status in ('booked', 'checked_in', 'in_progress')
          and s.starts_at >= now()
          and s.starts_at < now() + interval '7 days'),
    'awaiting_marking',
      (select count(*) from public.attempts where status = 'submitted' and marking_status in ('pending', 'awaiting_rubric')),
    'awaiting_decision',
      (select count(*) from public.applications where status in ('awaiting_decision', 'staff_review')),
    'staff_review',
      (select count(*) from public.applications where status = 'staff_review'),
    'no_shows_unresolved',
      (select count(*) from public.applications where status = 'no_show'),
    'unbooked_over_48h',
      (select count(*) from public.applications
        where status = 'new_enquiry' and requires_assessment
          and created_at < now() - interval '48 hours'),
    'offers_to_approve',
      (select count(*) from public.applications where status = 'offer_pending_approval'),
    'offers_blocked',
      (select count(*) from public.applications where status = 'offer_draft'),
    'outcomes_to_send',
      (select count(*) from public.tasks where status = 'open' and type = 'send_outcome'),
    'offers_outstanding',
      (select count(*) from public.applications where status = 'offer_sent'),
    'offers_expiring_3d',
      (select count(*) from public.offers
        where status in ('sent', 'viewed') and expires_at < now() + interval '3 days'),
    'payments_outstanding',
      (select count(*) from public.applications where status in ('payment_required', 'payment_processing')),
    'registrations_incomplete',
      (select count(*) from public.applications where status = 'registration_incomplete'),
    'enrolled',
      (select count(*) from public.applications where status = 'enrolled'),
    'tasks_open',
      (select count(*) from public.tasks where status = 'open'),
    'tasks_overdue',
      (select count(*) from public.tasks where status = 'open' and due_at < now()),
    'my_tasks_open',
      (select count(*) from public.tasks where status = 'open' and assignee_staff_id = auth.uid())
  )
$$;

revoke execute on function public.dashboard_counts() from public, anon;
grant execute on function public.dashboard_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.fee_schedules enable row level security;
alter table public.fee_lines enable row level security;
alter table public.offer_templates enable row level security;
alter table public.offers enable row level security;

-- Fees: seen by whoever sees offers or payments, changed by finance.
drop policy if exists fee_schedules_select on public.fee_schedules;
create policy fee_schedules_select on public.fee_schedules
  for select using (
    (select public.has_permission('offers.read')) or (select public.has_permission('finance.read'))
  );
drop policy if exists fee_schedules_write on public.fee_schedules;
create policy fee_schedules_write on public.fee_schedules
  for all using ((select public.has_permission('finance.write')))
  with check ((select public.has_permission('finance.write')));

drop policy if exists fee_lines_select on public.fee_lines;
create policy fee_lines_select on public.fee_lines
  for select using (
    (select public.has_permission('offers.read')) or (select public.has_permission('finance.read'))
  );
drop policy if exists fee_lines_write on public.fee_lines;
create policy fee_lines_write on public.fee_lines
  for all using ((select public.has_permission('finance.write')))
  with check ((select public.has_permission('finance.write')));

drop policy if exists offer_templates_select on public.offer_templates;
create policy offer_templates_select on public.offer_templates
  for select using ((select public.current_staff_id()) is not null);
drop policy if exists offer_templates_insert on public.offer_templates;
create policy offer_templates_insert on public.offer_templates
  for insert with check (
    (select public.has_permission('templates.write'))
    and created_by = (select auth.uid())
  );
drop policy if exists offer_templates_update on public.offer_templates;
create policy offer_templates_update on public.offer_templates
  for update using ((select public.has_permission('templates.write')));
-- No delete: a version that was ever active was offered to somebody.

-- Offers are written by the engine under the service role only. Approval,
-- withdrawal and sending all go through it so the application moves with
-- the offer and the audit trail is complete.
drop policy if exists offers_select on public.offers;
create policy offers_select on public.offers
  for select using (
    exists (
      select 1 from public.applications a
      where a.id = offers.application_id
        and (select public.has_permission('offers.read'))
        and (select public.can_access_campus(a.campus_id))
    )
  );

-- ---------------------------------------------------------------------------
-- Seed: the standard offer template
-- ---------------------------------------------------------------------------

insert into public.offer_templates (key, name, description, body_html, terms_html, allowed_variables)
values (
  'standard',
  'Standard offer of admission',
  'The offer every approved applicant receives. Rendered with the fee schedule for the campus, grade and year.',
  '<h1>Offer of Admission</h1><p>Dear {{parent_first_name}} {{parent_last_name}},</p><p>Following {{student_first_name}}''s assessment, we are delighted to offer <strong>{{student_first_name}} {{student_last_name}}</strong> a place at <strong>{{campus}}</strong> in <strong>{{grade}}</strong>, starting <strong>{{start_date}}</strong> ({{intake}}).</p><h2>Fees</h2><table class="details"><tr><td>Registration fee</td><td>{{registration_fee}}</td></tr><tr><td>Admission fee</td><td>{{admission_fee}}</td></tr>{{#if tuition_annual}}<tr><td>Annual tuition</td><td>{{tuition_annual}}</td></tr>{{/if}}{{#if tuition_term}}<tr><td>Tuition per term</td><td>{{tuition_term}}</td></tr>{{/if}}<tr><td><strong>Payable on acceptance</strong></td><td><strong>{{amount_due}}</strong></td></tr></table>{{#if conditions}}<h2>Conditions</h2><p>{{conditions}}</p>{{/if}}<p>This offer is open until <strong>{{offer_expiry_date}}</strong>.</p><p>Reference: {{application_reference}}</p><p>We look forward to welcoming {{student_first_name}} to Hibiscus Schools.</p>',
  '<h2>Terms</h2><p>The place is secured when the registration and admission fees have been paid in full. Fees are payable in {{currency}} and are not refundable once the place has been taken up. Tuition is invoiced by the school according to its published fee policy. Admission is subject to the school''s policies, which the parent or guardian accepts on enrolment.</p>',
  array['parent_first_name','parent_last_name','student_first_name','student_last_name','campus','grade','intake','start_date','offer_expiry_date','application_reference','registration_fee','admission_fee','tuition_annual','tuition_term','amount_due','currency','conditions']
)
on conflict (key, version) do nothing;
