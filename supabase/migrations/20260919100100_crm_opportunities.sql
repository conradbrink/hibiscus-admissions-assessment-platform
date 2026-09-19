-- Marketing opportunities: what could be offered to a family next.
--
-- An opportunity is one family (and usually one child) and one thing the
-- school sells or runs that they are not yet part of: robotics, swimming,
-- aftercare, transport, a holiday programme, a sibling's enrolment, next
-- term's place. It has a status a person moves (identified → contacted →
-- interested → registered or lost), a value so the marketing effort can be
-- costed, and an owner.
--
-- Two things are configurable rather than written into code, on purpose:
-- the *types* (what the school offers) and the *rules* that identify a
-- candidate ("Stage 4 to 7, not registered for robotics"). The engine that
-- runs the rules lives in `web/lib/crm/opportunities/` and is gated by
-- `crm_opportunity_engine_enabled`, off, like every automation here.
--
-- "Registered" for an activity is read from `student_optional_selections`,
-- which is where the family's choices already live: an opportunity type may
-- name the `optional_items.code` that means the family said yes. The
-- catalogue's category list is widened so an activity can be listed there
-- when the school prices one — no second catalogue.

-- ---------------------------------------------------------------------------
-- The catalogue may hold activities and programmes
-- ---------------------------------------------------------------------------

alter table public.optional_items drop constraint if exists optional_items_category_check;
alter table public.optional_items add constraint optional_items_category_check check (category in (
  'stationery', 'transport', 'lunch', 'aftercare', 'uniform',
  'activity', 'holiday_programme', 'extra_lessons', 'trip', 'other'
));

-- ---------------------------------------------------------------------------
-- Opportunity types
-- ---------------------------------------------------------------------------

create table if not exists public.opportunity_types (
  code text primary key check (code ~ '^[a-z0-9_]+$'),
  name text not null,
  description text,
  category text not null default 'other' check (category in ('activity', 'service', 'programme', 'enrolment', 'other')),
  -- What one conversion is worth, in the campus's minor unit, when the
  -- school knows. Null means "not costed", and the dashboard says so
  -- rather than showing a zero.
  default_value_minor bigint check (default_value_minor is null or default_value_minor >= 0),
  -- The catalogue code that means "the family took it up". Null for a type
  -- whose conversion a person records by hand (a sibling's enrolment).
  optional_item_code text check (optional_item_code is null or optional_item_code ~ '^[a-z0-9_]+$'),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists opportunity_types_set_updated_at on public.opportunity_types;
create trigger opportunity_types_set_updated_at
  before update on public.opportunity_types
  for each row execute function public.set_updated_at();

comment on table public.opportunity_types is
  'What the school can offer a family beyond the place: activities, services, programmes, and enrolment itself. Edited under CRM → Settings.';

insert into public.opportunity_types (code, name, description, category, optional_item_code, sort_order) values
  ('robotics',             'Robotics',              'The robotics club and the Make-a-Thon.',                    'activity',  'robotics',          10),
  ('swimming',             'Swimming',              'Swimming lessons.',                                         'activity',  'swimming',          20),
  ('holiday_programme',    'Holiday programme',     'The holiday programme between terms.',                      'programme', 'holiday_programme', 30),
  ('aftercare',            'Aftercare',             'Aftercare after the school day.',                           'service',   'aftercare',         40),
  ('transport',            'Transport',             'School transport to and from home.',                        'service',   'transport',         50),
  ('extra_lessons',        'Extra lessons',         'Additional lessons in a subject.',                          'programme', 'extra_lessons',     60),
  ('school_trip',          'School trip',           'A trip the school runs.',                                   'programme', 'trip',              70),
  ('uniform',              'Uniform',               'Uniform from the school shop.',                             'service',   'uniform',           80),
  ('additional_enrolment', 'Another child',         'A brother or sister who is not yet enrolled.',              'enrolment', null,                90),
  ('reenrolment',          'Re-enrolment',          'Next term''s place, not yet confirmed.',                    'enrolment', null,                100),
  ('other',                'Other',                 'Anything else the school offers.',                          'other',     null,                110)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Rules that identify a candidate
-- ---------------------------------------------------------------------------

-- `conditions` is one JSON object; the engine reads the keys it knows and
-- ignores the rest, so a rule authored before a key existed keeps working:
--
--   subject                 'student' (one opportunity per child) or 'family'
--   grade_sort_min/max      the child's grade, by grades.sort_order
--   campus_ids              only these campuses; empty means every campus
--   student_statuses        default ['onboarding', 'active']
--   not_registered_item     an optional_items code the child must not have
--                           selected (paid or selected) for the rule to fire
--   multiple_children_one_enrolled
--                           family: two or more children known, one enrolled
--   reenrolment_outstanding family: an unanswered question in an open round
create table if not exists public.opportunity_rules (
  code text primary key check (code ~ '^[a-z0-9_]+$'),
  name text not null,
  description text,
  type_code text not null references public.opportunity_types(code) on delete restrict,
  conditions jsonb not null default '{}'::jsonb,
  estimated_value_minor bigint check (estimated_value_minor is null or estimated_value_minor >= 0),
  is_active boolean not null default false,
  sort_order int not null default 0,
  last_run_at timestamptz,
  last_run_created int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists opportunity_rules_set_updated_at on public.opportunity_rules;
create trigger opportunity_rules_set_updated_at
  before update on public.opportunity_rules
  for each row execute function public.set_updated_at();

comment on table public.opportunity_rules is
  'The rules the opportunity engine runs once a day. Every rule ships inactive; the school switches each on under CRM → Settings.';

-- The examples from the brief, as rules, all off. Stage 4 is sort_order 90
-- and Stage 7 is 120 (`grades` seed, 20260904120100); Reception is 50.
insert into public.opportunity_rules (code, name, description, type_code, conditions, sort_order) values
  ('robotics_stage_4_to_7', 'Robotics: Stage 4 to 7',
   'A child in Stage 4 to Stage 7 who is not registered for robotics.',
   'robotics', '{"subject": "student", "grade_sort_min": 90, "grade_sort_max": 120, "not_registered_item": "robotics"}', 10),
  ('swimming_reception_up', 'Swimming: Reception and up',
   'A child from Reception upward who is not registered for swimming.',
   'swimming', '{"subject": "student", "grade_sort_min": 50, "not_registered_item": "swimming"}', 20),
  ('aftercare_primary', 'Aftercare: primary',
   'A primary child not using aftercare.',
   'aftercare', '{"subject": "student", "grade_sort_min": 50, "grade_sort_max": 120, "not_registered_item": "aftercare"}', 30),
  ('transport_any', 'Transport',
   'A child not using school transport.',
   'transport', '{"subject": "student", "not_registered_item": "transport"}', 40),
  ('holiday_programme_any', 'Holiday programme',
   'A child not signed up for the holiday programme.',
   'holiday_programme', '{"subject": "student", "not_registered_item": "holiday_programme"}', 50),
  ('sibling_not_enrolled', 'A brother or sister not yet enrolled',
   'A family with more than one child known to us and only one of them enrolled.',
   'additional_enrolment', '{"subject": "family", "multiple_children_one_enrolled": true}', 60),
  ('reenrolment_outstanding', 'Re-enrolment outstanding',
   'A family that has not answered an open re-enrolment round.',
   'reenrolment', '{"subject": "family", "reenrolment_outstanding": true}', 70)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Opportunities
-- ---------------------------------------------------------------------------

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  type_code text not null references public.opportunity_types(code) on delete restrict,
  -- Denormalised, like `tasks.campus_id`, so the read policy is one call.
  campus_id uuid not null references public.campuses(id) on delete restrict,
  estimated_value_minor bigint check (estimated_value_minor is null or estimated_value_minor >= 0),
  actual_value_minor bigint check (actual_value_minor is null or actual_value_minor >= 0),
  currency text not null check (currency in ('BWP', 'ZAR')),
  status text not null default 'identified' check (status in ('identified', 'contacted', 'interested', 'registered', 'lost')),
  assigned_staff_id uuid references public.staff_profiles(id) on delete set null,
  source text not null default 'staff' check (source in ('rule', 'staff', 'automation')),
  rule_code text references public.opportunity_rules(code) on delete set null,
  last_contact_at timestamptz,
  next_action text,
  next_action_at timestamptz,
  lost_reason text,
  notes text,
  contacted_at timestamptz,
  interested_at timestamptz,
  registered_at timestamptz,
  lost_at timestamptz,
  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One open opportunity of a type per child (or per family, for a family
-- rule). The engine upserts against this, so running it twice a day creates
-- nothing twice; a lost or registered one may be followed by a new one next
-- year.
create unique index if not exists opportunities_open_idx
  on public.opportunities(family_id, coalesce(student_id, family_id), type_code)
  where status in ('identified', 'contacted', 'interested');
create index if not exists opportunities_campus_status_idx on public.opportunities(campus_id, status);
create index if not exists opportunities_family_idx on public.opportunities(family_id);
create index if not exists opportunities_student_idx on public.opportunities(student_id) where student_id is not null;
create index if not exists opportunities_assigned_idx on public.opportunities(assigned_staff_id) where assigned_staff_id is not null;
create index if not exists opportunities_type_status_idx on public.opportunities(type_code, status);
create index if not exists opportunities_created_idx on public.opportunities(created_at desc);
create index if not exists opportunities_next_action_idx on public.opportunities(next_action_at) where next_action_at is not null and status in ('identified', 'contacted', 'interested');

drop trigger if exists opportunities_set_updated_at on public.opportunities;
create trigger opportunities_set_updated_at
  before update on public.opportunities
  for each row execute function public.set_updated_at();

comment on table public.opportunities is
  'One thing that could be offered to one family. Identified by a rule or a person; moved by a person; converted when the family takes it up.';

-- The currency is the campus's, copied on the way in, so a Potch family's
-- rand value is never added to a Block 7 family's pula.
create or replace function public.opportunities_before_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  select c.currency into new.currency from public.campuses c where c.id = new.campus_id;
  if new.estimated_value_minor is null then
    select coalesce(r.estimated_value_minor, t.default_value_minor) into new.estimated_value_minor
      from public.opportunity_types t
      left join public.opportunity_rules r on r.code = new.rule_code
     where t.code = new.type_code;
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'contacted' then new.contacted_at := coalesce(new.contacted_at, now()); end if;
    if new.status = 'interested' then new.interested_at := coalesce(new.interested_at, now()); end if;
    if new.status = 'registered' then new.registered_at := coalesce(new.registered_at, now()); end if;
    if new.status = 'lost' then new.lost_at := coalesce(new.lost_at, now()); end if;
  end if;
  return new;
end;
$$;

revoke all on function public.opportunities_before_write() from public, anon, authenticated;

drop trigger if exists opportunities_before_write on public.opportunities;
create trigger opportunities_before_write
  before insert or update on public.opportunities
  for each row execute function public.opportunities_before_write();

-- The outbox and the audit trail hear about every one.
create or replace function public.opportunities_after_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_label text;
begin
  if v_actor is not null then
    select email into v_label from public.staff_profiles where id = v_actor;
  end if;
  if tg_op = 'INSERT' then
    insert into public.crm_trigger_events (type, family_id, student_id, payload)
    values ('opportunity.created', new.family_id, new.student_id,
            jsonb_build_object('opportunity_id', new.id, 'type_code', new.type_code, 'campus_id', new.campus_id, 'source', new.source));
    insert into public.audit_log (actor_type, actor_id, actor_label, action, entity_type, entity_id, family_id, after)
    values (case when v_actor is null then 'system' else 'staff' end, v_actor, coalesce(v_label, 'System'),
            'opportunity.created', 'opportunity', new.id, new.family_id,
            jsonb_build_object('type_code', new.type_code, 'status', new.status, 'source', new.source, 'rule_code', new.rule_code));
  elsif new.status is distinct from old.status then
    insert into public.crm_trigger_events (type, family_id, student_id, payload)
    values ('opportunity.status_changed', new.family_id, new.student_id,
            jsonb_build_object('opportunity_id', new.id, 'type_code', new.type_code, 'from', old.status, 'to', new.status));
    insert into public.audit_log (actor_type, actor_id, actor_label, action, entity_type, entity_id, family_id, before, after)
    values (case when v_actor is null then 'system' else 'staff' end, v_actor, coalesce(v_label, 'System'),
            'opportunity.status_changed', 'opportunity', new.id, new.family_id,
            jsonb_build_object('status', old.status), jsonb_build_object('status', new.status, 'lost_reason', new.lost_reason));
  end if;
  return null;
end;
$$;

revoke all on function public.opportunities_after_write() from public, anon, authenticated;

drop trigger if exists opportunities_after_write on public.opportunities;
create trigger opportunities_after_write
  after insert or update on public.opportunities
  for each row execute function public.opportunities_after_write();

-- A note may now point at one.
alter table public.crm_notes
  drop constraint if exists crm_notes_opportunity_id_fkey;
alter table public.crm_notes
  add constraint crm_notes_opportunity_id_fkey
  foreign key (opportunity_id) references public.opportunities(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Who may see what
-- ---------------------------------------------------------------------------

alter table public.opportunity_types enable row level security;
alter table public.opportunity_rules enable row level security;
alter table public.opportunities enable row level security;

drop policy if exists opportunity_types_select on public.opportunity_types;
create policy opportunity_types_select on public.opportunity_types
  for select using ((select public.current_staff_id()) is not null);

drop policy if exists opportunity_types_write on public.opportunity_types;
create policy opportunity_types_write on public.opportunity_types
  for all using ((select public.has_permission('settings.write')))
  with check ((select public.has_permission('settings.write')));

drop policy if exists opportunity_rules_select on public.opportunity_rules;
create policy opportunity_rules_select on public.opportunity_rules
  for select using ((select public.current_staff_id()) is not null);

drop policy if exists opportunity_rules_write on public.opportunity_rules;
create policy opportunity_rules_write on public.opportunity_rules
  for all using ((select public.has_permission('settings.write')))
  with check ((select public.has_permission('settings.write')));

drop policy if exists opportunities_select on public.opportunities;
create policy opportunities_select on public.opportunities
  for select using (
    (select public.has_permission('crm.read'))
    and (select public.can_access_campus(campus_id))
  );

drop policy if exists opportunities_insert on public.opportunities;
create policy opportunities_insert on public.opportunities
  for insert with check (
    (select public.has_permission('crm.write'))
    and (select public.can_access_campus(campus_id))
    and source = 'staff'
    and created_by = (select auth.uid())
  );

drop policy if exists opportunities_update on public.opportunities;
create policy opportunities_update on public.opportunities
  for update using (
    (select public.has_permission('crm.write'))
    and (select public.can_access_campus(campus_id))
  );

-- No delete policy: an opportunity that was identified and lost is a fact
-- the conversion rate is made of.

-- The note policy can now ask the opportunity itself, under its own policy.
drop policy if exists crm_notes_select on public.crm_notes;
create policy crm_notes_select on public.crm_notes
  for select using (
    (
      (family_id is not null and (select public.can_access_family(family_id)))
      or (student_id is not null and (select public.has_permission('students.read')) and (select public.can_access_student(student_id)))
      or (task_id is not null and exists (select 1 from public.tasks t where t.id = crm_notes.task_id))
      or (opportunity_id is not null and exists (select 1 from public.opportunities o where o.id = crm_notes.opportunity_id))
      or (campaign_id is not null and (select public.has_permission('crm.read')))
    )
    and (
      not is_private
      or author_staff_id = (select auth.uid())
      or (family_id is not null and (select public.can_edit_family(family_id)))
      or (select public.has_permission('admin'))
    )
  );

-- ---------------------------------------------------------------------------
-- The opportunity dashboard, in one call
-- ---------------------------------------------------------------------------

-- Security invoker: the rows counted are the rows the caller may see, so a
-- campus manager's dashboard is their campus's. One row per type, with the
-- pipeline counts and the two sums the marketing meeting wants: what it
-- could be worth, and what it has been worth.
create or replace function public.crm_opportunity_summary(p_campus_id uuid default null)
returns table (
  type_code text,
  type_name text,
  currency text,
  total bigint,
  identified bigint,
  contacted bigint,
  interested bigint,
  registered bigint,
  lost bigint,
  potential_value_minor bigint,
  actual_value_minor bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select t.code,
         t.name,
         coalesce(max(o.currency), 'BWP'),
         count(o.id),
         count(o.id) filter (where o.status = 'identified'),
         count(o.id) filter (where o.status = 'contacted'),
         count(o.id) filter (where o.status = 'interested'),
         count(o.id) filter (where o.status = 'registered'),
         count(o.id) filter (where o.status = 'lost'),
         coalesce(sum(o.estimated_value_minor) filter (where o.status in ('identified', 'contacted', 'interested')), 0),
         coalesce(sum(coalesce(o.actual_value_minor, o.estimated_value_minor)) filter (where o.status = 'registered'), 0)
    from public.opportunity_types t
    left join public.opportunities o
      on o.type_code = t.code
     and (p_campus_id is null or o.campus_id = p_campus_id)
   where t.is_active
   group by t.code, t.name, t.sort_order
   order by t.sort_order
$$;

revoke execute on function public.crm_opportunity_summary(uuid) from public, anon;
grant execute on function public.crm_opportunity_summary(uuid) to authenticated;
