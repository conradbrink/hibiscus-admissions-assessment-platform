-- Automations: when this happens, do these.
--
-- An automation is a trigger (a row type in `crm_trigger_events`), a set of
-- conditions on that row, and a list of actions. The drain reads the outbox,
-- finds the active automations for each row's type, checks the conditions,
-- runs the actions and writes a run — one row per automation per event —
-- so what fired, and why nothing fired, can be read back.
--
-- The actions are a closed list the engine knows (`web/lib/crm/automations/`):
-- create a task, send a family email, send its WhatsApp companion, assign a
-- member of staff, set the next follow-up, add a tag, create an opportunity,
-- notify somebody. Anything that reaches a parent goes through the senders
-- that already exist and obeys their rules: a template, consent, the
-- WhatsApp switch.
--
-- Every automation ships off, and the engine itself is behind
-- `crm_automations_enabled`, also off. Two switches, on purpose: the school
-- turns the engine on once, then each automation as it trusts it.

create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_]+$'),
  name text not null,
  description text,
  trigger_type text not null check (trigger_type in (
    'family.created', 'enquiry.created', 'application.status_changed', 'family.lifecycle_changed',
    'student.enrolled', 'student.status_changed', 'reenrolment.opened', 'reenrolment.asked', 'reenrolment.answered',
    'opportunity.created', 'opportunity.status_changed', 'event.registered', 'event.attended'
  )),
  -- {campus_ids: [], to: [], from: [], entry_routes: [], heard_from: [],
  --  type_codes: [], lifecycle_stages: []} — every key optional, every
  -- given key must match.
  conditions jsonb not null default '{}'::jsonb,
  -- [{type: 'create_task', title, details, due_days, priority, assign},
  --  {type: 'send_email', template_key, link},
  --  {type: 'send_whatsapp', template_key, link},
  --  {type: 'assign_staff', staff_id | 'application_owner'},
  --  {type: 'set_follow_up', days},
  --  {type: 'add_tag', tag},
  --  {type: 'create_opportunity', type_code},
  --  {type: 'notify', to: 'assignee' | staff_id, title, body}]
  actions jsonb not null default '[]'::jsonb,
  is_active boolean not null default false,
  sort_order int not null default 0,
  last_run_at timestamptz,
  run_count int not null default 0,
  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists automations_trigger_idx on public.automations(trigger_type) where is_active;

drop trigger if exists automations_set_updated_at on public.automations;
create trigger automations_set_updated_at
  before update on public.automations
  for each row execute function public.set_updated_at();

comment on table public.automations is
  'A trigger, conditions and actions. Every one ships off; the engine that runs them is behind crm_automations_enabled, also off.';

create table if not exists public.automation_runs (
  id bigint generated always as identity primary key,
  automation_id uuid not null references public.automations(id) on delete cascade,
  trigger_event_id bigint references public.crm_trigger_events(id) on delete set null,
  family_id uuid references public.families(id) on delete cascade,
  status text not null check (status in ('done', 'skipped', 'failed')),
  -- What each action did, in order, in words a person can read.
  log jsonb not null default '[]'::jsonb,
  error text,
  ran_at timestamptz not null default now()
);

create index if not exists automation_runs_automation_idx on public.automation_runs(automation_id, id desc);
create index if not exists automation_runs_family_idx on public.automation_runs(family_id, id desc) where family_id is not null;

comment on table public.automation_runs is
  'Append-only. One row per automation per event it was offered, including the ones its conditions turned down.';

-- ---------------------------------------------------------------------------
-- The four from the brief, all off
-- ---------------------------------------------------------------------------

-- Wording lives in `email_templates` and `message_templates`, not here; the
-- welcome template these name is seeded below. Task titles are staff-facing.
insert into public.automations (code, name, description, trigger_type, conditions, actions, sort_order) values
  ('new_enquiry', 'New enquiry',
   'When an enquiry arrives: the family goes to the person who owns the application, with a follow-up task and a follow-up date. The funnel has already sent the family its own confirmation.',
   'enquiry.created', '{}',
   '[{"type": "assign_staff", "staff": "application_owner"},
     {"type": "create_task", "title": "Follow up the new enquiry", "details": "Ring or message the family within two working days.", "due_days": 2, "priority": "normal", "assign": "assignee"},
     {"type": "set_follow_up", "days": 2}]',
   10),
  ('application_accepted', 'Offer accepted',
   'When a family accepts an offer: an onboarding task for the owner and a note to the campus team. The lifecycle moves on its own.',
   'application.status_changed', '{"to": ["offer_accepted"]}',
   '[{"type": "create_task", "title": "Start onboarding the family", "details": "The offer has been accepted. Introduce yourself and say what happens next.", "due_days": 3, "priority": "high", "assign": "application_owner"},
     {"type": "add_tag", "tag": "accepted"}]',
   20),
  ('new_active_family', 'New active family',
   'When a family''s first child starts attending: a welcome email, a tag, and a follow-up a fortnight later.',
   'family.lifecycle_changed', '{"to": ["active"]}',
   '[{"type": "send_email", "template_key": "crm_welcome_family", "link": "family"},
     {"type": "add_tag", "tag": "active_family"},
     {"type": "set_follow_up", "days": 14},
     {"type": "create_task", "title": "Check in with the new family", "details": "Two weeks in. Ask how the first days went.", "due_days": 14, "priority": "normal", "assign": "assignee"}]',
   30),
  ('reenrolment_open', 'Re-enrolment round opened',
   'When a round opens: a re-enrolment opportunity for every family in it and the re-enrolment tag on each.',
   'reenrolment.asked', '{}',
   '[{"type": "create_opportunity", "type_code": "reenrolment"},
     {"type": "add_tag", "tag": "reenrolment_open"}]',
   40),
  ('reenrolment_answered', 'Re-enrolment answered',
   'When a family answers: close the opportunity and take the tag off.',
   'reenrolment.answered', '{}',
   '[{"type": "resolve_opportunity", "type_code": "reenrolment"},
     {"type": "remove_tag", "tag": "reenrolment_open"}]',
   50),
  ('opportunity_identified', 'Opportunity identified',
   'When the engine finds an opportunity: tell the family''s assigned member of staff.',
   'opportunity.created', '{"source": ["rule"]}',
   '[{"type": "notify", "to": "assignee", "title": "New opportunity", "body": "A marketing opportunity was identified for a family you look after."}]',
   60)
on conflict (code) do nothing;

-- The welcome to a family whose first child has started. Plain English,
-- family audience, a family link so the parent lands on the hub.
insert into public.email_templates (key, version, name, description, subject, body_text, body_html, allowed_variables, is_active, audience)
values (
  'crm_welcome_family', 1,
  'Welcome to the school',
  'Sent by the "New active family" automation when a family''s first child starts attending.',
  'Welcome to {{campus}}, {{parent_first_name}}',
  'Dear {{parent_first_name}},

{{student_first_name}} has started at {{campus}}. Welcome to the Hibiscus family.

Everything we hold for your children is in one place, and you can check it at any time:
{{family_link}}

If anything is wrong, or you have a question, reply to this email and we will help.

Warm regards,
Hibiscus International Schools',
  '<p>Dear {{parent_first_name}},</p>'
  || '<p>{{student_first_name}} has started at {{campus}}. Welcome to the Hibiscus family.</p>'
  || '<p><a href="{{family_link}}">See everything we hold for your children</a></p>'
  || '<p>If anything is wrong, or you have a question, reply to this email and we will help.</p>'
  || '<p>Warm regards,<br>Hibiscus International Schools</p>',
  array['parent_first_name', 'student_first_name', 'campus', 'family_link'],
  true, 'family'
)
on conflict (key, version) do nothing;

-- Its WhatsApp companion. Inactive until the school has the template
-- approved and pastes its provider id in, like every other one.
insert into public.message_templates (key, name, language, body_preview, parameters, button_link, link_purpose, is_active, audience)
values
  ('crm_welcome_family', 'Welcome to the school', 'en',
   'Hello {{1}}, {{2}} has started at {{3}}. Welcome to the Hibiscus family. Tap below to see everything we hold for your children.',
   array['parent_first_name', 'student_first_name', 'campus'], true, 'family', false, 'family')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

alter table public.automations enable row level security;
alter table public.automation_runs enable row level security;

drop policy if exists automations_select on public.automations;
create policy automations_select on public.automations
  for select using ((select public.has_permission('crm.read')));

drop policy if exists automations_write on public.automations;
create policy automations_write on public.automations
  for all using ((select public.has_permission('settings.write')))
  with check ((select public.has_permission('settings.write')));

drop policy if exists automation_runs_select on public.automation_runs;
create policy automation_runs_select on public.automation_runs
  for select using (
    (select public.has_permission('crm.read'))
    and (family_id is null or (select public.can_access_family(family_id)))
  );

-- No write policy on runs: the engine writes them under the service role.
