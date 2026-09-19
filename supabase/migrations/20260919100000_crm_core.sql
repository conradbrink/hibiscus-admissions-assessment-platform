-- The CRM: the family, from first enquiry to alumni.
--
-- Stage A (`20260911100000_crm_core.sql`) gave a child a row that outlives
-- their application, and a family a row that siblings share. What it did not
-- give the school is a way to *work* those rows: who the parents are and how
-- they may be contacted, where each family is in its life with the school,
-- who looks after them, what was last said to them, and what could be offered
-- to them next.
--
-- This migration is the foundation the rest of the CRM stands on. It does
-- not create a second family, parent or student: `families`, `contacts` and
-- `students` are extended in place, every existing key is kept, and the
-- funnel is untouched — `commit_transition()` is still the only writer of
-- `applications.status`, and the CRM only *listens* to it.
--
-- What arrives here:
--
--   permissions   crm.read, crm.write, crm.campaigns.write,
--                 crm.campaigns.approve, crm.campaigns.approve_sensitive,
--                 crm.export, crm.import — and three roles the school named
--                 (marketing, reception, teacher).
--   families      the relationship fields: campus, primary and secondary
--                 contact, preferred channel and language, lead source,
--                 lifecycle stage, assigned staff, last contact, next
--                 follow-up, tags, active flag, referral.
--   contacts      relationship to the child, and marketing consent per
--                 channel, held apart from the WhatsApp *updates* opt-in the
--                 funnel already asks for.
--   lifecycle     computed from what admissions and the register already
--                 know, so nobody types the same fact in two places.
--   crm_notes     a note on a family, a child, an opportunity, a task or a
--                 campaign.
--   crm_trigger_events
--                 the outbox the automations read: an enquiry arrived, a
--                 status moved, a child enrolled, a lifecycle changed.

-- ---------------------------------------------------------------------------
-- Permissions and roles
-- ---------------------------------------------------------------------------

insert into public.permissions (code, label, sort_order) values
  ('crm.read',                        'View the CRM: families, contacts, opportunities and communications', 180),
  ('crm.write',                       'Edit families and contacts, add notes, create opportunities and events', 182),
  ('crm.campaigns.write',             'Create segments and campaigns and submit them for approval',          184),
  ('crm.campaigns.approve',           'Approve a campaign before it is sent',                                186),
  ('crm.campaigns.approve_sensitive', 'Approve fee, policy and group-wide campaigns',                        187),
  ('crm.export',                      'Export CRM lists and reports',                                        188),
  ('crm.import',                      'Import families and contacts from a file',                            189)
on conflict (code) do update set label = excluded.label, sort_order = excluded.sort_order;

-- Three roles the school asked for by name. Reception and teachers are
-- campus-scoped: a receptionist at Phase 2 has no business in Block 7's
-- families, and the policies fail closed for them until a campus is
-- assigned (`roles.campus_scoped`, migration 20260904210000).
insert into public.roles (code, name, description, is_system, campus_scoped) values
  ('marketing', 'Marketing',  'Campaigns, segments, opportunities and communications across the group.', true, false),
  ('reception', 'Reception',  'Find a family, add a note, log an enquiry and set a task, at their own campus.', true, true),
  ('teacher',   'Teacher',    'A child''s family and contacts at their own campus. Nothing else.', true, true)
on conflict (code) do update set name = excluded.name, description = excluded.description, campus_scoped = excluded.campus_scoped;

with grants(role_code, permission_code) as (
  values
    ('admissions_manager', 'crm.read'),
    ('admissions_manager', 'crm.write'),
    ('admissions_manager', 'crm.campaigns.write'),
    ('admissions_manager', 'crm.campaigns.approve'),
    ('admissions_manager', 'crm.export'),
    ('admissions_manager', 'crm.import'),

    ('admissions_staff', 'crm.read'),
    ('admissions_staff', 'crm.write'),

    ('campus_admin', 'crm.read'),
    ('campus_admin', 'crm.write'),
    ('campus_admin', 'crm.campaigns.write'),

    -- Group management: every campus, the analytics, and the approvals —
    -- including the sensitive ones. Still no write on a family.
    ('management', 'crm.read'),
    ('management', 'crm.campaigns.approve'),
    ('management', 'crm.campaigns.approve_sensitive'),
    ('management', 'crm.export'),

    ('marketing', 'crm.read'),
    ('marketing', 'crm.write'),
    ('marketing', 'crm.campaigns.write'),
    ('marketing', 'crm.export'),
    ('marketing', 'students.read'),
    ('marketing', 'analytics.read'),
    ('marketing', 'templates.write'),
    ('marketing', 'tasks.write'),

    ('finance', 'crm.read'),

    ('reception', 'crm.read'),
    ('reception', 'crm.write'),
    ('reception', 'tasks.write'),

    ('teacher', 'crm.read')
)
insert into public.role_permissions (role_id, permission_code)
select r.id, g.permission_code
  from grants g
  join public.roles r on r.code = g.role_code
    on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The family, as a relationship
-- ---------------------------------------------------------------------------

alter table public.families
  -- The campus the family belongs to, for scoping and for filtering. Kept in
  -- step with the children's newest live enrolment by `crm_sync_family`;
  -- before any child is enrolled it is the campus they enquired at.
  add column if not exists campus_id uuid references public.campuses(id) on delete set null,
  add column if not exists primary_contact_id uuid references public.contacts(id) on delete set null,
  add column if not exists secondary_contact_id uuid references public.contacts(id) on delete set null,
  add column if not exists preferred_channel text
    check (preferred_channel is null or preferred_channel in ('email', 'whatsapp', 'phone', 'sms')),
  add column if not exists preferred_language text,
  -- One key from `web/lib/heard-from.ts`, copied from the first application
  -- so the CRM and the admissions analytics count the same source.
  add column if not exists lead_source text,
  add column if not exists lead_source_detail text,
  add column if not exists lifecycle_stage text not null default 'new_enquiry' check (lifecycle_stage in (
    'new_enquiry', 'qualified', 'applicant', 'assessment', 'offer',
    'onboarding', 'active', 'reenrolment', 'alumni', 'inactive'
  )),
  add column if not exists lifecycle_changed_at timestamptz not null default now(),
  -- True once a person has set the stage by hand; the automatic sync then
  -- leaves it alone until they hand it back.
  add column if not exists lifecycle_manual boolean not null default false,
  add column if not exists assigned_staff_id uuid references public.staff_profiles(id) on delete set null,
  add column if not exists last_contact_at timestamptz,
  add column if not exists next_follow_up_at timestamptz,
  add column if not exists tags text[] not null default '{}'::text[],
  add column if not exists is_active boolean not null default true,
  add column if not exists referred_by_family_id uuid references public.families(id) on delete set null,
  add column if not exists referral_note text,
  add column if not exists source text not null default 'admissions'
    check (source in ('admissions', 'staff', 'import')),
  add column if not exists created_by uuid references public.staff_profiles(id) on delete set null;

create index if not exists families_campus_idx on public.families(campus_id) where merged_into_id is null;
create index if not exists families_lifecycle_idx on public.families(lifecycle_stage) where merged_into_id is null;
create index if not exists families_assigned_idx on public.families(assigned_staff_id) where assigned_staff_id is not null;
create index if not exists families_last_contact_idx on public.families(last_contact_at);
create index if not exists families_follow_up_idx on public.families(next_follow_up_at) where next_follow_up_at is not null;
create index if not exists families_created_idx on public.families(created_at desc);
create index if not exists families_tags_idx on public.families using gin(tags);
create index if not exists families_referred_by_idx on public.families(referred_by_family_id) where referred_by_family_id is not null;
create index if not exists families_display_name_idx on public.families(lower(display_name));

comment on column public.families.lifecycle_stage is
  'Where the family is with the school. Computed by crm_sync_family() from admissions and the register unless lifecycle_manual is set.';
comment on column public.families.campus_id is
  'The family''s home campus: the newest live enrolment''s, or the campus they enquired at. What the CRM scopes and filters by.';

-- ---------------------------------------------------------------------------
-- The contact, as a person the school may or may not write to
-- ---------------------------------------------------------------------------

alter table public.contacts
  add column if not exists relationship text not null default 'parent'
    check (relationship in ('mother', 'father', 'parent', 'guardian', 'grandparent', 'other')),
  -- Marketing consent, one flag per channel, held apart from
  -- `whatsapp_opt_in`. That flag is the parent asking for *updates* about
  -- their own application; this is permission to be told about robotics
  -- club. A STOP clears both. Nothing here defaults to yes.
  add column if not exists marketing_email_consent boolean not null default false,
  add column if not exists marketing_email_consent_at timestamptz,
  add column if not exists marketing_whatsapp_consent boolean not null default false,
  add column if not exists marketing_whatsapp_consent_at timestamptz,
  add column if not exists sms_consent boolean not null default false,
  add column if not exists sms_consent_at timestamptz,
  add column if not exists consent_source text
    check (consent_source is null or consent_source in ('enquiry', 'registration', 'staff', 'reply', 'import', 'unsubscribe')),
  add column if not exists unsubscribed_at timestamptz,
  -- The token in every marketing email's unsubscribe link. Random, never
  -- the contact id, so a link cannot be guessed from a record.
  add column if not exists unsubscribe_token text unique default md5(gen_random_uuid()::text || clock_timestamp()::text),
  add column if not exists preferred_channel text
    check (preferred_channel is null or preferred_channel in ('email', 'whatsapp', 'phone', 'sms')),
  add column if not exists notes text,
  add column if not exists is_active boolean not null default true;

create index if not exists contacts_name_idx on public.contacts(lower(last_name), lower(first_name));

comment on column public.contacts.marketing_email_consent is
  'Permission to send this person marketing email. Distinct from transactional mail about their own child, which needs none.';
comment on column public.contacts.marketing_whatsapp_consent is
  'Permission to send marketing on WhatsApp. Both this and whatsapp_opt_in must hold; a STOP clears both.';

-- ---------------------------------------------------------------------------
-- Who may see a family
-- ---------------------------------------------------------------------------

-- The one question every CRM policy asks. Security definer so the policies
-- on `families` and `contacts`, which now reach each other, cannot recurse.
-- Three ways in, any one suffices:
--   · a child at a campus you may see (students.read),
--   · an application at a campus you may see (applications.read),
--   · the family's own campus, for the CRM (crm.read) — the arm that makes a
--     family with no application yet (a walk-in logged at the desk, an
--     import) reachable at all.
create or replace function public.can_access_family(p_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_family_id is not null and (
    (
      public.has_permission('students.read')
      and exists (
        select 1 from public.students s
         where s.family_id = p_family_id
           and public.can_access_campus(s.current_campus_id)
      )
    )
    or (
      public.has_permission('applications.read')
      and exists (
        select 1 from public.contacts c
          join public.applications a on a.contact_id = c.id
         where c.family_id = p_family_id
           and public.can_access_campus(a.campus_id)
      )
    )
    or (
      public.has_permission('crm.read')
      and exists (
        select 1 from public.families f
         where f.id = p_family_id
           and f.campus_id is not null
           and public.can_access_campus(f.campus_id)
      )
    )
  )
$$;

revoke execute on function public.can_access_family(uuid) from public, anon;
grant execute on function public.can_access_family(uuid) to authenticated;

-- The same, for writing: crm.write and the family's campus, or students.write
-- through a child. Reading through an application does not confer editing:
-- an assessor may see the family of a child they mark and may not rename it.
create or replace function public.can_edit_family(p_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_family_id is not null and (
    (
      public.has_permission('crm.write')
      and exists (
        select 1 from public.families f
         where f.id = p_family_id
           and f.campus_id is not null
           and public.can_access_campus(f.campus_id)
      )
    )
    or (
      public.has_permission('students.write')
      and exists (
        select 1 from public.students s
         where s.family_id = p_family_id
           and public.can_access_campus(s.current_campus_id)
      )
    )
  )
$$;

revoke execute on function public.can_edit_family(uuid) from public, anon;
grant execute on function public.can_edit_family(uuid) to authenticated;

drop policy if exists families_select on public.families;
create policy families_select on public.families
  for select using ((select public.can_access_family(id)));

drop policy if exists families_update on public.families;
create policy families_update on public.families
  for update using ((select public.can_edit_family(id)));

-- A family may now be written down by a person: a walk-in at the desk, a
-- referral, a parent who rang. It needs a campus so it is scoped from the
-- first second, and it is stamped with who created it.
drop policy if exists families_insert on public.families;
create policy families_insert on public.families
  for insert with check (
    (select public.has_permission('crm.write'))
    and campus_id is not null
    and (select public.can_access_campus(campus_id))
    and created_by = (select auth.uid())
  );

-- No delete policy, as before: a family that existed is a fact.

drop policy if exists contacts_select on public.contacts;
create policy contacts_select on public.contacts
  for select using (
    (
      (select public.has_permission('applications.read'))
      and exists (
        select 1 from public.applications a
        where a.contact_id = contacts.id
          and (select public.can_access_campus(a.campus_id))
      )
    )
    or (select public.can_access_family(contacts.family_id))
  );

drop policy if exists contacts_update on public.contacts;
create policy contacts_update on public.contacts
  for update using (
    (
      (select public.has_permission('applications.write'))
      and exists (
        select 1 from public.applications a
        where a.contact_id = contacts.id
          and (select public.can_access_campus(a.campus_id))
      )
    )
    or (select public.can_edit_family(contacts.family_id))
  );

drop policy if exists contacts_insert on public.contacts;
create policy contacts_insert on public.contacts
  for insert with check (
    (select public.has_permission('applications.write'))
    or (family_id is not null and (select public.can_edit_family(family_id)))
  );

-- ---------------------------------------------------------------------------
-- A contact inserted onto an existing family takes that family's code
-- ---------------------------------------------------------------------------

-- The trigger from `20260909160000` mints a fresh code for every contact
-- whose code is null, and `20260911100000` taught it to mint the family row
-- too. Neither expected a contact to arrive already naming a family — that
-- is what the CRM does when a second parent is added to a family somebody
-- typed in — and would have given the second parent a different code from
-- the first, which is exactly the split the code exists to prevent.
create or replace function public.contacts_set_family_code()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_family uuid;
  v_code text;
begin
  if new.family_id is not null and new.family_code is null then
    select family_code into v_code from public.families where id = new.family_id;
    new.family_code := v_code;
  end if;

  if new.family_code is null then
    new.family_code := public.next_family_code(new.last_name);
  end if;

  if new.family_id is null then
    select id into v_family
      from public.families
     where family_code = new.family_code and merged_into_id is null;
    if v_family is null then
      insert into public.families (family_code, display_name)
      values (new.family_code, new.last_name)
      returning id into v_family;
    end if;
    new.family_id := v_family;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Creating a family by hand
-- ---------------------------------------------------------------------------

-- `next_family_code()` is service-role only, so a family typed in at the desk
-- goes through this. Security definer for that one call; everything it
-- checks — the permission, the campus, who is asking — it checks itself.
create or replace function public.crm_create_family(
  p_display_name text,
  p_campus_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_mobile text,
  p_mobile_normalised text,
  p_relationship text default 'parent',
  p_lead_source text default null,
  p_lead_source_detail text default null,
  p_preferred_channel text default null,
  p_preferred_language text default null,
  p_home_address text default null,
  p_notes text default null,
  p_tags text[] default '{}',
  p_assigned_staff_id uuid default null,
  p_referred_by_family_id uuid default null,
  p_marketing_email boolean default false,
  p_marketing_whatsapp boolean default false,
  p_sms boolean default false,
  p_whatsapp_opt_in boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_family uuid;
  v_contact uuid;
  v_email text := lower(trim(p_email));
begin
  if v_actor is null or not public.has_permission('crm.write') then
    raise exception 'permission_denied';
  end if;
  if p_campus_id is null or not public.can_access_campus(p_campus_id) then
    raise exception 'campus_not_allowed';
  end if;
  if exists (select 1 from public.contacts where email_normalised = v_email) then
    raise exception 'contact_email_exists';
  end if;

  insert into public.families (
    family_code, display_name, campus_id, home_address, notes,
    lead_source, lead_source_detail, preferred_channel, preferred_language,
    tags, assigned_staff_id, referred_by_family_id, source, created_by
  ) values (
    public.next_family_code(p_last_name), nullif(trim(p_display_name), ''), p_campus_id, nullif(trim(p_home_address), ''), nullif(trim(p_notes), ''),
    p_lead_source, nullif(trim(p_lead_source_detail), ''), p_preferred_channel, nullif(trim(p_preferred_language), ''),
    coalesce(p_tags, '{}'), p_assigned_staff_id, p_referred_by_family_id, 'staff', v_actor
  )
  returning id into v_family;

  insert into public.contacts (
    first_name, last_name, email, email_normalised, mobile, mobile_normalised,
    family_id, relationship,
    whatsapp_opt_in, whatsapp_opt_in_at, whatsapp_opt_in_source,
    marketing_email_consent, marketing_email_consent_at,
    marketing_whatsapp_consent, marketing_whatsapp_consent_at,
    sms_consent, sms_consent_at, consent_source
  ) values (
    trim(p_first_name), trim(p_last_name), trim(p_email), v_email, nullif(trim(p_mobile), ''), p_mobile_normalised,
    v_family, coalesce(p_relationship, 'parent'),
    coalesce(p_whatsapp_opt_in, false), case when p_whatsapp_opt_in then now() end, case when p_whatsapp_opt_in then 'staff' end,
    coalesce(p_marketing_email, false), case when p_marketing_email then now() end,
    coalesce(p_marketing_whatsapp, false), case when p_marketing_whatsapp then now() end,
    coalesce(p_sms, false), case when p_sms then now() end,
    case when p_marketing_email or p_marketing_whatsapp or p_sms then 'staff' end
  )
  returning id into v_contact;

  update public.families set primary_contact_id = v_contact where id = v_family;

  insert into public.audit_log (actor_type, actor_id, actor_label, action, entity_type, entity_id, after)
  select 'staff', v_actor, sp.email, 'family.created', 'family', v_family,
         jsonb_build_object('display_name', p_display_name, 'campus_id', p_campus_id, 'contact_id', v_contact)
    from public.staff_profiles sp where sp.id = v_actor;

  insert into public.crm_trigger_events (type, family_id, payload)
  values ('family.created', v_family, jsonb_build_object('source', 'staff'));

  return v_family;
end;
$$;

revoke execute on function public.crm_create_family(text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text[], uuid, uuid, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.crm_create_family(text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text[], uuid, uuid, boolean, boolean, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- The outbox the automations read
-- ---------------------------------------------------------------------------

-- Every fact the CRM might act on lands here as a row, written by triggers
-- inside the same transaction as the fact itself, and read by the drain.
-- The engine that moves an application does not know the CRM exists, and
-- that is the point: nothing in the funnel changes shape to feed this.
--
-- Service role only. No staff policy at all: the rows are the automation's
-- to-do list, not a report.
create table if not exists public.crm_trigger_events (
  id bigint generated always as identity primary key,
  type text not null,
  family_id uuid references public.families(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  application_id uuid references public.applications(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  processed_at timestamptz,
  outcome text check (outcome is null or outcome in ('done', 'nothing', 'failed')),
  error text
);

create index if not exists crm_trigger_events_pending_idx
  on public.crm_trigger_events(id) where processed_at is null;
create index if not exists crm_trigger_events_family_idx
  on public.crm_trigger_events(family_id, id desc);

alter table public.crm_trigger_events enable row level security;

comment on table public.crm_trigger_events is
  'The CRM''s outbox: one row per fact the automations may act on, written by trigger, read by the drain. Service role only.';

-- ---------------------------------------------------------------------------
-- The lifecycle, computed
-- ---------------------------------------------------------------------------

-- Where a family is with the school, read off what admissions and the
-- register already record. Ordered from "most with us" down: a child at
-- school outranks a sibling's enquiry, and an open re-enrolment question
-- outranks everything, because it is the one thing the school is waiting
-- on the family for.
create or replace function public.crm_compute_lifecycle(p_family_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with s as (
    select status from public.students where family_id = p_family_id
  ), a as (
    select a.status
      from public.applications a
      join public.contacts c on c.id = a.contact_id
     where c.family_id = p_family_id
       and a.anonymised_at is null
  ), r as (
    select 1
      from public.reenrolment_responses rr
      join public.reenrolment_cycles rc on rc.id = rr.cycle_id
      join public.students st on st.id = rr.student_id
     where st.family_id = p_family_id
       and rc.status = 'open'
       and rr.answered_at is null
  )
  select case
    when exists (select 1 from r) then 'reenrolment'
    when exists (select 1 from s where status in ('active', 'on_leave')) then 'active'
    when exists (select 1 from s where status = 'onboarding') then 'onboarding'
    when exists (select 1 from a where status in (
      'offer_accepted', 'payment_required', 'payment_processing', 'paid',
      'registration_incomplete', 'registration_complete', 'enrolled')) then 'onboarding'
    when exists (select 1 from a where status in (
      'approved', 'waitlisted', 'offer_draft', 'offer_pending_approval', 'offer_sent', 'offer_expired')) then 'offer'
    when exists (select 1 from a where status in (
      'assessment_in_progress', 'assessment_completed', 'awaiting_decision', 'staff_review', 'no_show', 'deferred')) then 'assessment'
    when exists (select 1 from a where status = 'assessment_booked') then 'applicant'
    when exists (select 1 from a where status = 'visit_booked') then 'qualified'
    when exists (select 1 from a where status in ('new_enquiry', 'callback_requested')) then 'new_enquiry'
    when exists (select 1 from s where status in ('left', 'graduated')) then 'alumni'
    when exists (select 1 from a) then 'inactive'
    else 'new_enquiry'
  end
$$;

revoke execute on function public.crm_compute_lifecycle(uuid) from public, anon;
grant execute on function public.crm_compute_lifecycle(uuid) to authenticated;

-- Brings one family up to date: its campus, its stage, and its lead source
-- where none was recorded. Writes the outbox and the audit log only when the
-- stage actually moved, and never when a person has taken the stage by hand.
create or replace function public.crm_sync_family(p_family_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  f public.families%rowtype;
  v_stage text;
  v_campus uuid;
  v_source text;
  v_detail text;
  v_primary uuid;
begin
  select * into f from public.families where id = p_family_id;
  if not found or f.merged_into_id is not null then
    return;
  end if;

  v_stage := public.crm_compute_lifecycle(p_family_id);

  -- The children's campus first, then the newest enquiry's.
  select s.current_campus_id into v_campus
    from public.students s
   where s.family_id = p_family_id and s.status in ('onboarding', 'active', 'on_leave')
   order by s.updated_at desc
   limit 1;
  if v_campus is null then
    select a.campus_id into v_campus
      from public.applications a
      join public.contacts c on c.id = a.contact_id
     where c.family_id = p_family_id
     order by a.created_at desc
     limit 1;
  end if;

  if f.lead_source is null then
    select a.heard_from, a.heard_from_detail into v_source, v_detail
      from public.applications a
      join public.contacts c on c.id = a.contact_id
     where c.family_id = p_family_id and a.heard_from is not null
     order by a.created_at
     limit 1;
  end if;

  if f.primary_contact_id is null then
    select id into v_primary from public.contacts where family_id = p_family_id order by created_at limit 1;
  end if;

  update public.families
     set campus_id = coalesce(v_campus, campus_id),
         lead_source = coalesce(lead_source, v_source),
         lead_source_detail = coalesce(lead_source_detail, v_detail),
         primary_contact_id = coalesce(primary_contact_id, v_primary),
         lifecycle_stage = case when lifecycle_manual then lifecycle_stage else v_stage end,
         lifecycle_changed_at = case when not lifecycle_manual and v_stage is distinct from lifecycle_stage then now() else lifecycle_changed_at end,
         is_active = case when lifecycle_manual then is_active else v_stage <> 'inactive' end
   where id = p_family_id;

  if not f.lifecycle_manual and v_stage is distinct from f.lifecycle_stage then
    insert into public.crm_trigger_events (type, family_id, payload)
    values ('family.lifecycle_changed', p_family_id, jsonb_build_object('from', f.lifecycle_stage, 'to', v_stage));

    insert into public.audit_log (actor_type, actor_label, action, entity_type, entity_id, before, after)
    values ('system', 'System', 'family.lifecycle_changed', 'family', p_family_id,
            jsonb_build_object('lifecycle_stage', f.lifecycle_stage), jsonb_build_object('lifecycle_stage', v_stage));
  end if;
end;
$$;

revoke execute on function public.crm_sync_family(uuid) from public, anon, authenticated;

-- The family of an application, for the triggers below.
-- Security invoker: under a person it answers only for an application they
-- may already read, so it can never map a stranger's application to a family.
create or replace function public.crm_family_of_application(p_application_id uuid)
returns uuid
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select c.family_id
    from public.applications a
    join public.contacts c on c.id = a.contact_id
   where a.id = p_application_id
$$;

revoke execute on function public.crm_family_of_application(uuid) from public, anon, authenticated;

-- An application arrived or moved. The outbox learns of both; the family's
-- stage follows.
create or replace function public.crm_on_application_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_family uuid;
begin
  select family_id into v_family from public.contacts where id = new.contact_id;
  if v_family is null then
    return null;
  end if;

  if tg_op = 'INSERT' then
    insert into public.crm_trigger_events (type, family_id, application_id, payload)
    values ('enquiry.created', v_family, new.id,
            jsonb_build_object('status', new.status, 'campus_id', new.campus_id, 'grade_id', new.grade_id,
                               'entry_route', new.entry_route, 'source', new.source, 'heard_from', new.heard_from));
  elsif new.status is distinct from old.status then
    insert into public.crm_trigger_events (type, family_id, application_id, payload)
    values ('application.status_changed', v_family, new.id,
            jsonb_build_object('from', old.status, 'to', new.status, 'campus_id', new.campus_id, 'grade_id', new.grade_id));
  end if;

  perform public.crm_sync_family(v_family);
  return null;
end;
$$;

revoke all on function public.crm_on_application_change() from public, anon, authenticated;

drop trigger if exists crm_on_application_change on public.applications;
create trigger crm_on_application_change
  after insert or update of status, campus_id on public.applications
  for each row execute function public.crm_on_application_change();

-- A child arrived on the register, or their status changed.
create or replace function public.crm_on_student_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.crm_trigger_events (type, family_id, student_id, application_id, payload)
    values ('student.enrolled', new.family_id, new.id, new.origin_application_id,
            jsonb_build_object('campus_id', new.current_campus_id, 'grade_id', new.current_grade_id));
  elsif new.status is distinct from old.status then
    insert into public.crm_trigger_events (type, family_id, student_id, payload)
    values ('student.status_changed', new.family_id, new.id,
            jsonb_build_object('from', old.status, 'to', new.status, 'campus_id', new.current_campus_id));
  end if;
  perform public.crm_sync_family(new.family_id);
  -- A merge moves a child between families; both sides move.
  if tg_op = 'UPDATE' and old.family_id is distinct from new.family_id then
    perform public.crm_sync_family(old.family_id);
  end if;
  return null;
end;
$$;

revoke all on function public.crm_on_student_change() from public, anon, authenticated;

drop trigger if exists crm_on_student_change on public.students;
create trigger crm_on_student_change
  after insert or update of status, family_id, current_campus_id on public.students
  for each row execute function public.crm_on_student_change();

-- A re-enrolment question opened or was answered.
create or replace function public.crm_on_reenrolment_response()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_family uuid;
begin
  select family_id into v_family from public.students where id = new.student_id;
  if v_family is null then
    return null;
  end if;
  if tg_op = 'INSERT' then
    insert into public.crm_trigger_events (type, family_id, student_id, payload)
    values ('reenrolment.asked', v_family, new.student_id, jsonb_build_object('cycle_id', new.cycle_id, 'campus_id', new.campus_id));
  elsif new.answered_at is not null and old.answered_at is null then
    insert into public.crm_trigger_events (type, family_id, student_id, payload)
    values ('reenrolment.answered', v_family, new.student_id,
            jsonb_build_object('cycle_id', new.cycle_id, 'intent', new.intent, 'campus_id', new.campus_id));
  end if;
  perform public.crm_sync_family(v_family);
  return null;
end;
$$;

revoke all on function public.crm_on_reenrolment_response() from public, anon, authenticated;

drop trigger if exists crm_on_reenrolment_response on public.reenrolment_responses;
create trigger crm_on_reenrolment_response
  after insert or update of intent, answered_at on public.reenrolment_responses
  for each row execute function public.crm_on_reenrolment_response();

-- Closing a round answers every open question at once, as far as the
-- lifecycle is concerned.
create or replace function public.crm_on_reenrolment_cycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  if new.status is distinct from old.status then
    if new.status = 'open' then
      insert into public.crm_trigger_events (type, payload)
      values ('reenrolment.opened', jsonb_build_object('cycle_id', new.id, 'campus_id', new.campus_id, 'intake_id', new.intake_id));
    end if;
    for r in
      select distinct s.family_id
        from public.reenrolment_responses rr
        join public.students s on s.id = rr.student_id
       where rr.cycle_id = new.id
    loop
      perform public.crm_sync_family(r.family_id);
    end loop;
  end if;
  return null;
end;
$$;

revoke all on function public.crm_on_reenrolment_cycle() from public, anon, authenticated;

drop trigger if exists crm_on_reenrolment_cycle on public.reenrolment_cycles;
create trigger crm_on_reenrolment_cycle
  after update of status on public.reenrolment_cycles
  for each row execute function public.crm_on_reenrolment_cycle();

-- A contact moved between families (a merge): both sides recompute.
create or replace function public.crm_on_contact_family_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.family_id is distinct from old.family_id then
    if new.family_id is not null then perform public.crm_sync_family(new.family_id); end if;
    if old.family_id is not null then perform public.crm_sync_family(old.family_id); end if;
  end if;
  return null;
end;
$$;

revoke all on function public.crm_on_contact_family_change() from public, anon, authenticated;

drop trigger if exists crm_on_contact_family_change on public.contacts;
create trigger crm_on_contact_family_change
  after update of family_id on public.contacts
  for each row execute function public.crm_on_contact_family_change();

-- ---------------------------------------------------------------------------
-- "Last contact" follows the two message logs
-- ---------------------------------------------------------------------------

create or replace function public.crm_touch_family_contact()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_family uuid := new.family_id;
begin
  if v_family is null and new.contact_id is not null then
    select family_id into v_family from public.contacts where id = new.contact_id;
  end if;
  if v_family is null and new.application_id is not null then
    v_family := public.crm_family_of_application(new.application_id);
  end if;
  if v_family is not null then
    update public.families
       set last_contact_at = greatest(coalesce(last_contact_at, new.created_at), new.created_at)
     where id = v_family;
  end if;
  return null;
end;
$$;

revoke all on function public.crm_touch_family_contact() from public, anon, authenticated;

drop trigger if exists crm_touch_family_on_email on public.email_messages;
create trigger crm_touch_family_on_email
  after insert on public.email_messages
  for each row execute function public.crm_touch_family_contact();

drop trigger if exists crm_touch_family_on_message on public.messages;
create trigger crm_touch_family_on_message
  after insert on public.messages
  for each row execute function public.crm_touch_family_contact();

-- ---------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------

-- `notes` belongs to an application and stays there. This is the CRM's: a
-- note on a family, a child, an opportunity, a task or a campaign — exactly
-- one — with an author, a time, and a private flag for the things a
-- receptionist writes for the admissions manager and nobody else.
create table if not exists public.crm_notes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.families(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  opportunity_id uuid,
  task_id uuid references public.tasks(id) on delete cascade,
  campaign_id uuid,
  author_staff_id uuid not null references public.staff_profiles(id) on delete cascade,
  body text not null check (length(body) between 1 and 4000),
  is_private boolean not null default false,
  is_pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_notes_has_one_subject check (
    (family_id is not null)::int + (student_id is not null)::int + (opportunity_id is not null)::int
      + (task_id is not null)::int + (campaign_id is not null)::int = 1
  )
);

create index if not exists crm_notes_family_idx on public.crm_notes(family_id, created_at desc) where family_id is not null;
create index if not exists crm_notes_student_idx on public.crm_notes(student_id, created_at desc) where student_id is not null;
create index if not exists crm_notes_opportunity_idx on public.crm_notes(opportunity_id) where opportunity_id is not null;
create index if not exists crm_notes_task_idx on public.crm_notes(task_id) where task_id is not null;
create index if not exists crm_notes_campaign_idx on public.crm_notes(campaign_id) where campaign_id is not null;

drop trigger if exists crm_notes_set_updated_at on public.crm_notes;
create trigger crm_notes_set_updated_at
  before update on public.crm_notes
  for each row execute function public.set_updated_at();

alter table public.crm_notes enable row level security;

-- A note is readable where its subject is. A private one, by its author and
-- by whoever may edit the family, which is who it was written for.
drop policy if exists crm_notes_select on public.crm_notes;
create policy crm_notes_select on public.crm_notes
  for select using (
    (
      (family_id is not null and (select public.can_access_family(family_id)))
      or (student_id is not null and (select public.has_permission('students.read')) and (select public.can_access_student(student_id)))
      or (task_id is not null and exists (select 1 from public.tasks t where t.id = crm_notes.task_id))
      -- Opportunities and campaigns carry their own campus; their policies
      -- are asked through the row itself once those tables exist.
      or (opportunity_id is not null and (select public.has_permission('crm.read')))
      or (campaign_id is not null and (select public.has_permission('crm.read')))
    )
    and (
      not is_private
      or author_staff_id = (select auth.uid())
      or (family_id is not null and (select public.can_edit_family(family_id)))
      or (select public.has_permission('admin'))
    )
  );

drop policy if exists crm_notes_insert on public.crm_notes;
create policy crm_notes_insert on public.crm_notes
  for insert with check (
    author_staff_id = (select auth.uid())
    and (select public.has_permission('crm.write'))
    and (
      (family_id is not null and (select public.can_access_family(family_id)))
      or (student_id is not null and (select public.can_access_student(student_id)))
      or (task_id is not null and exists (select 1 from public.tasks t where t.id = crm_notes.task_id))
      or opportunity_id is not null
      or campaign_id is not null
    )
  );

drop policy if exists crm_notes_update on public.crm_notes;
create policy crm_notes_update on public.crm_notes
  for update using (author_staff_id = (select auth.uid()));

drop policy if exists crm_notes_delete on public.crm_notes;
create policy crm_notes_delete on public.crm_notes
  for delete using (author_staff_id = (select auth.uid()) or (select public.has_permission('admin')));

-- ---------------------------------------------------------------------------
-- The audit log, for entities that have no application
-- ---------------------------------------------------------------------------

-- `audit_log_select` shows rows with no application to anyone holding
-- audit.read, and that stays. A CRM row about a family at another campus
-- should not, so the policy grows a family arm: a row naming a family is
-- readable when the family is.
alter table public.audit_log add column if not exists family_id uuid;
create index if not exists audit_log_family_idx on public.audit_log(family_id, id desc) where family_id is not null;

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select using (
    (select public.has_permission('audit.read'))
    and (
      (audit_log.application_id is null and audit_log.family_id is null)
      or (
        audit_log.application_id is not null
        and exists (
          select 1 from public.applications a
          where a.id = audit_log.application_id
            and (select public.can_access_campus(a.campus_id))
        )
      )
      or (audit_log.family_id is not null and (select public.can_access_family(audit_log.family_id)))
    )
  );

-- ---------------------------------------------------------------------------
-- Every family already here
-- ---------------------------------------------------------------------------

-- Without the outbox or the audit trail: this is the first reading, not a
-- change. Campus, lead source and primary contact are filled in from what
-- the funnel recorded; the stage is computed the same way it will be from
-- now on.
update public.families f
   set campus_id = coalesce(f.campus_id, (
         select s.current_campus_id from public.students s
          where s.family_id = f.id and s.status in ('onboarding', 'active', 'on_leave')
          order by s.updated_at desc limit 1
       ), (
         select a.campus_id from public.applications a join public.contacts c on c.id = a.contact_id
          where c.family_id = f.id order by a.created_at desc limit 1
       )),
       lead_source = coalesce(f.lead_source, (
         select a.heard_from from public.applications a join public.contacts c on c.id = a.contact_id
          where c.family_id = f.id and a.heard_from is not null order by a.created_at limit 1
       )),
       lead_source_detail = coalesce(f.lead_source_detail, (
         select a.heard_from_detail from public.applications a join public.contacts c on c.id = a.contact_id
          where c.family_id = f.id and a.heard_from is not null order by a.created_at limit 1
       )),
       primary_contact_id = coalesce(f.primary_contact_id, (
         select c.id from public.contacts c where c.family_id = f.id order by c.created_at limit 1
       )),
       lifecycle_stage = public.crm_compute_lifecycle(f.id),
       is_active = public.crm_compute_lifecycle(f.id) <> 'inactive',
       last_contact_at = coalesce(f.last_contact_at, greatest(
         (select max(e.created_at) from public.email_messages e join public.contacts c on c.id = e.contact_id where c.family_id = f.id),
         (select max(m.created_at) from public.messages m join public.contacts c on c.id = m.contact_id where c.family_id = f.id)
       ))
 where f.merged_into_id is null;

-- A contact who was given two family codes by the trigger's old behaviour
-- is not repaired here: `merge_family_code()` is the sanctioned path, and
-- the CRM's duplicate finder is how the office finds them.

-- ---------------------------------------------------------------------------
-- Settings the CRM reads
-- ---------------------------------------------------------------------------

insert into public.settings (key, value, description) values
  ('crm_campaign_approval_required', 'true',
   'Every campaign must be approved by a second person before it can be scheduled or sent.'),
  ('crm_automations_enabled', 'false',
   'Run the CRM automations from the job drain. Each automation also has its own switch.'),
  ('crm_opportunity_engine_enabled', 'false',
   'Identify marketing opportunities from the active rules once a day.'),
  ('crm_follow_up_days', '3',
   'Days after a new enquiry by which a family should have been contacted; drives the follow-up reminders.'),
  ('crm_stale_contact_days', '30',
   'Days without contact after which a family counts as "no response" on the dashboard and in segments.')
on conflict (key) do nothing;
