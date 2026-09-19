-- Notifications, imports, search, and the dashboard's numbers.

-- ---------------------------------------------------------------------------
-- In-app notifications
-- ---------------------------------------------------------------------------

-- One row per thing a person should know: a task given to them, a reply
-- waiting, a campaign that wants their approval, an opportunity for a
-- family they look after. Written under the service role by the code that
-- knows the fact; read and marked read by the person alone.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_profiles(id) on delete cascade,
  kind text not null check (kind in (
    'enquiry', 'task_assigned', 'task_overdue', 'whatsapp_reply', 'email_reply',
    'campaign_approval_requested', 'campaign_approved', 'campaign_rejected', 'campaign_sent',
    'opportunity_created', 'family_activity', 'import_finished', 'other'
  )),
  title text not null check (length(title) between 1 and 200),
  body text,
  href text,
  family_id uuid references public.families(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_unread_idx on public.notifications(staff_id, created_at desc) where read_at is null;
create index if not exists notifications_staff_idx on public.notifications(staff_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select using (staff_id = (select auth.uid()));

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update using (staff_id = (select auth.uid()))
  with check (staff_id = (select auth.uid()));

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete using (staff_id = (select auth.uid()));

-- No insert policy: the service role writes them.

comment on table public.notifications is
  'What a person should know, one row each. Written by the system; readable and dismissable by that person only.';

-- ---------------------------------------------------------------------------
-- The WhatsApp inbox: which replies a person has seen
-- ---------------------------------------------------------------------------

alter table public.messages
  add column if not exists crm_read_at timestamptz,
  add column if not exists crm_read_by uuid references public.staff_profiles(id) on delete set null;

create index if not exists messages_unread_inbound_idx
  on public.messages(contact_id, received_at desc)
  where direction = 'in' and crm_read_at is null;
create index if not exists messages_contact_idx on public.messages(contact_id, created_at desc) where contact_id is not null;
create index if not exists email_messages_contact_idx on public.email_messages(contact_id, created_at desc) where contact_id is not null;

-- A campaign is a fourth reason a WhatsApp message goes out.
alter table public.messages drop constraint if exists messages_trigger_source_check;
alter table public.messages add constraint messages_trigger_source_check
  check (trigger_source is null or trigger_source in ('companion', 'manual', 'family', 'inbound', 'campaign'));

comment on column public.messages.crm_read_at is
  'When a member of staff opened this reply in the CRM inbox. Null is unread. Not the provider''s read receipt, which is read_at.';

-- ---------------------------------------------------------------------------
-- Imports
-- ---------------------------------------------------------------------------

-- A file is parsed, every row is judged (valid, a likely duplicate of a
-- family already here, or an error), the person reads the verdict, and only
-- then does anything get written. The rows are kept for the review and for
-- the record of what was imported, and pruned by the drain a month later —
-- they hold names and numbers, and a month is long enough to argue about
-- them.
create table if not exists public.crm_imports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('families', 'contacts')),
  filename text not null,
  campus_id uuid references public.campuses(id) on delete set null,
  status text not null default 'previewed' check (status in ('previewed', 'committed', 'cancelled')),
  total_rows int not null default 0,
  valid_rows int not null default 0,
  duplicate_rows int not null default 0,
  error_rows int not null default 0,
  imported_rows int not null default 0,
  skipped_rows int not null default 0,
  created_by uuid not null references public.staff_profiles(id) on delete cascade,
  committed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists crm_imports_created_by_idx on public.crm_imports(created_by, created_at desc);

create table if not exists public.crm_import_rows (
  id bigint generated always as identity primary key,
  import_id uuid not null references public.crm_imports(id) on delete cascade,
  row_no int not null,
  data jsonb not null,
  status text not null check (status in ('valid', 'duplicate', 'error', 'imported', 'skipped')),
  message text,
  duplicate_family_id uuid references public.families(id) on delete set null,
  family_id uuid references public.families(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (import_id, row_no)
);

alter table public.crm_imports enable row level security;
alter table public.crm_import_rows enable row level security;

-- Your own imports, and only with the permission. An import is not a shared
-- artefact; it is a working file, and the families it created are shared.
drop policy if exists crm_imports_select on public.crm_imports;
create policy crm_imports_select on public.crm_imports
  for select using (
    (select public.has_permission('crm.import'))
    and (created_by = (select auth.uid()) or (select public.has_permission('admin')))
  );

drop policy if exists crm_imports_insert on public.crm_imports;
create policy crm_imports_insert on public.crm_imports
  for insert with check (
    (select public.has_permission('crm.import'))
    and created_by = (select auth.uid())
    and (campus_id is null or (select public.can_access_campus(campus_id)))
  );

drop policy if exists crm_imports_update on public.crm_imports;
create policy crm_imports_update on public.crm_imports
  for update using (
    (select public.has_permission('crm.import'))
    and created_by = (select auth.uid())
  );

drop policy if exists crm_import_rows_select on public.crm_import_rows;
create policy crm_import_rows_select on public.crm_import_rows
  for select using (
    exists (select 1 from public.crm_imports i where i.id = crm_import_rows.import_id)
  );

drop policy if exists crm_import_rows_insert on public.crm_import_rows;
create policy crm_import_rows_insert on public.crm_import_rows
  for insert with check (
    exists (select 1 from public.crm_imports i where i.id = crm_import_rows.import_id and i.created_by = (select auth.uid()))
  );

drop policy if exists crm_import_rows_update on public.crm_import_rows;
create policy crm_import_rows_update on public.crm_import_rows
  for update using (
    exists (select 1 from public.crm_imports i where i.id = crm_import_rows.import_id and i.created_by = (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- Search
-- ---------------------------------------------------------------------------

-- One search across families, parents, children and applicants, under the
-- caller's own rights, with the kind on every row so the results page can
-- group them. `p_q` is matched as a substring on names, codes, references,
-- email and mobile; a phone number is matched with its spaces removed.
create or replace function public.crm_search(p_q text, p_limit int default 8)
returns table (kind text, id uuid, title text, subtitle text, href text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with q as (
    select '%' || lower(trim(p_q)) || '%' as pat,
           '%' || regexp_replace(trim(p_q), '[^0-9+]', '', 'g') || '%' as digits,
           length(regexp_replace(trim(p_q), '[^0-9]', '', 'g')) >= 5 as is_number
  )
  (
    select 'family', f.id,
           coalesce(f.display_name, f.family_code) || ' family',
           f.family_code || coalesce(' · ' || c.name, ''),
           '/staff/crm/families/' || f.id
      from public.families f
      left join public.campuses c on c.id = f.campus_id, q
     where f.merged_into_id is null
       and (lower(coalesce(f.display_name, '')) like q.pat or lower(f.family_code) like q.pat)
     order by f.display_name
     limit p_limit
  )
  union all
  (
    select 'contact', ct.id,
           ct.first_name || ' ' || ct.last_name,
           ct.email || coalesce(' · ' || ct.mobile, ''),
           '/staff/crm/contacts/' || ct.id
      from public.contacts ct, q
     where lower(ct.first_name || ' ' || ct.last_name) like q.pat
        or lower(ct.email) like q.pat
        or (q.is_number and coalesce(ct.mobile_normalised, '') like q.digits)
     order by ct.last_name, ct.first_name
     limit p_limit
  )
  union all
  (
    select 'student', s.id,
           coalesce(s.preferred_name, s.legal_first_name) || ' ' || s.legal_last_name,
           s.student_code || coalesce(' · ' || g.name, '') || coalesce(' · ' || c.name, ''),
           '/staff/students/' || s.id
      from public.students s
      left join public.grades g on g.id = s.current_grade_id
      left join public.campuses c on c.id = s.current_campus_id, q
     where lower(s.legal_first_name || ' ' || s.legal_last_name) like q.pat
        or lower(coalesce(s.preferred_name, '') || ' ' || s.legal_last_name) like q.pat
        or lower(s.student_code) like q.pat
     order by s.legal_last_name, s.legal_first_name
     limit p_limit
  )
  union all
  (
    select 'applicant', a.id,
           a.child_first_name || ' ' || a.child_last_name,
           a.reference || ' · ' || a.status || coalesce(' · ' || c.name, ''),
           '/staff/applications/' || a.id
      from public.applications a
      left join public.campuses c on c.id = a.campus_id, q
     where a.anonymised_at is null
       and (lower(a.child_first_name || ' ' || a.child_last_name) like q.pat or lower(a.reference) like q.pat)
     order by a.created_at desc
     limit p_limit
  )
$$;

revoke execute on function public.crm_search(text, int) from public, anon;
grant execute on function public.crm_search(text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Likely duplicates of a family about to be created
-- ---------------------------------------------------------------------------

-- Before a family is typed in: the same email, the same mobile, or the same
-- parent surname with a child of the same name. Under the caller's rights,
-- so a match at a campus they cannot see is not offered — and cannot leak.
create or replace function public.crm_find_duplicates(
  p_email text default null,
  p_mobile_normalised text default null,
  p_last_name text default null,
  p_first_name text default null,
  p_child_first_name text default null
)
returns table (family_id uuid, family_code text, display_name text, campus_name text, reason text, contact_name text, contact_email text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select distinct on (f.id) f.id, f.family_code, f.display_name, c.name,
         case
           when p_email is not null and ct.email_normalised = lower(trim(p_email)) then 'Same email address'
           when p_mobile_normalised is not null and ct.mobile_normalised = p_mobile_normalised then 'Same mobile number'
           else 'Same parent name'
         end,
         ct.first_name || ' ' || ct.last_name,
         ct.email
    from public.contacts ct
    join public.families f on f.id = ct.family_id
    left join public.campuses c on c.id = f.campus_id
   where f.merged_into_id is null
     and (
       (p_email is not null and ct.email_normalised = lower(trim(p_email)))
       or (p_mobile_normalised is not null and ct.mobile_normalised = p_mobile_normalised)
       or (
         p_last_name is not null and lower(ct.last_name) = lower(trim(p_last_name))
         and (
           (p_first_name is not null and lower(ct.first_name) = lower(trim(p_first_name)))
           or (p_child_first_name is not null and exists (
             select 1 from public.students s
              where s.family_id = f.id and lower(s.legal_first_name) = lower(trim(p_child_first_name))
             union all
             select 1 from public.applications a
              where a.contact_id = ct.id and lower(a.child_first_name) = lower(trim(p_child_first_name))
           ))
         )
       )
     )
   order by f.id, ct.created_at
   limit 10
$$;

revoke execute on function public.crm_find_duplicates(text, text, text, text, text) from public, anon;
grant execute on function public.crm_find_duplicates(text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Merging two families
-- ---------------------------------------------------------------------------

-- Two families that are one: every contact, child, opportunity, note,
-- registration and message moves to the survivor, which keeps its code; the
-- loser is marked merged. Never automatic — the console asks, and the
-- person confirms. `merge_family_code` did this for one contact at a time
-- and is what the register still calls; this is the CRM's whole-family form
-- of it.
create or replace function public.crm_merge_families(p_loser_id uuid, p_survivor_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_label text;
  v_code text;
  r record;
begin
  if v_actor is null or not public.has_permission('crm.write') then
    raise exception 'permission_denied';
  end if;
  if p_loser_id = p_survivor_id then
    raise exception 'same_family';
  end if;
  if not public.can_edit_family(p_loser_id) or not public.can_edit_family(p_survivor_id) then
    raise exception 'family_not_allowed';
  end if;
  select family_code into v_code from public.families where id = p_survivor_id and merged_into_id is null;
  if v_code is null then
    raise exception 'survivor_not_live';
  end if;

  perform set_config('app.family_code_merge', 'on', true);
  update public.contacts set family_id = p_survivor_id, family_code = v_code where family_id = p_loser_id;
  perform set_config('app.family_code_merge', 'off', true);

  update public.students set family_id = p_survivor_id where family_id = p_loser_id;
  update public.opportunities set family_id = p_survivor_id where family_id = p_loser_id;
  update public.crm_notes set family_id = p_survivor_id where family_id = p_loser_id;
  update public.crm_event_registrations set family_id = p_survivor_id where family_id = p_loser_id
    and not exists (select 1 from public.crm_event_registrations x where x.event_id = crm_event_registrations.event_id and x.family_id = p_survivor_id);
  update public.email_messages set family_id = p_survivor_id where family_id = p_loser_id;
  update public.messages set family_id = p_survivor_id where family_id = p_loser_id;
  update public.access_tokens set family_id = p_survivor_id where family_id = p_loser_id;
  update public.families set referred_by_family_id = p_survivor_id where referred_by_family_id = p_loser_id;

  update public.families
     set merged_into_id = p_survivor_id,
         is_active = false,
         primary_contact_id = null,
         secondary_contact_id = null
   where id = p_loser_id;

  -- The survivor keeps what it had and gains what it lacked.
  select * into r from public.families where id = p_loser_id;
  update public.families f
     set display_name = coalesce(f.display_name, r.display_name),
         home_address = coalesce(f.home_address, r.home_address),
         lead_source = coalesce(f.lead_source, r.lead_source),
         lead_source_detail = coalesce(f.lead_source_detail, r.lead_source_detail),
         assigned_staff_id = coalesce(f.assigned_staff_id, r.assigned_staff_id),
         tags = coalesce((select array_agg(distinct t) from unnest(f.tags || r.tags) as t), '{}'),
         notes = case when r.notes is null then f.notes when f.notes is null then r.notes else f.notes || E'\n\n' || r.notes end,
         last_contact_at = greatest(f.last_contact_at, r.last_contact_at)
   where f.id = p_survivor_id;
  update public.families f
     set primary_contact_id = coalesce(f.primary_contact_id, (select id from public.contacts where family_id = f.id order by created_at limit 1))
   where f.id = p_survivor_id;

  perform public.crm_sync_family(p_survivor_id);

  select email into v_label from public.staff_profiles where id = v_actor;
  insert into public.audit_log (actor_type, actor_id, actor_label, action, entity_type, entity_id, family_id, before, after)
  values ('staff', v_actor, v_label, 'family.merged', 'family', p_survivor_id, p_survivor_id,
          jsonb_build_object('merged_family_id', p_loser_id, 'merged_family_code', r.family_code),
          jsonb_build_object('family_code', v_code));
end;
$$;

revoke execute on function public.crm_merge_families(uuid, uuid) from public, anon;
grant execute on function public.crm_merge_families(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The dashboard's numbers, in one call
-- ---------------------------------------------------------------------------

-- Security invoker, so every count is over what the caller may see; the
-- campus argument narrows further. One round trip for the whole first
-- screen, like `dashboard_counts()` does for admissions.
create or replace function public.crm_dashboard_counts(p_campus_id uuid default null)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with fam as (
    select * from public.v_crm_family_facts v
     where (p_campus_id is null or v.campus_id = p_campus_id)
  ),
  month_start as (
    select date_trunc('month', now() at time zone 'Africa/Gaborone') as at
  ),
  stale as (
    select coalesce((select (value)::int from public.settings where key = 'crm_stale_contact_days'), 30) as days
  )
  select jsonb_build_object(
    'families_total', (select count(*) from fam),
    'families_active', (select count(*) from fam where is_active and lifecycle_stage in ('active', 'reenrolment', 'onboarding')),
    'families_new_this_month', (select count(*) from fam, month_start where fam.created_at >= month_start.at),
    'enquiries_new_this_month', (
      select count(*) from public.applications a, month_start
       where a.created_at >= month_start.at
         and (p_campus_id is null or a.campus_id = p_campus_id)
    ),
    'students_active', (
      select count(*) from public.students s
       where s.status in ('active', 'onboarding', 'on_leave')
         and (p_campus_id is null or s.current_campus_id = p_campus_id)
    ),
    'by_lifecycle', (
      select coalesce(jsonb_object_agg(lifecycle_stage, n), '{}'::jsonb)
        from (select lifecycle_stage, count(*) as n from fam group by lifecycle_stage) t
    ),
    'by_campus', (
      select coalesce(jsonb_agg(jsonb_build_object('campus_id', campus_id, 'campus_name', campus_name, 'families', n) order by campus_name), '[]'::jsonb)
        from (select campus_id, campus_name, count(*) as n from fam group by campus_id, campus_name) t
    ),
    'whatsapp_sent_30d', (
      select count(*) from public.messages m
       where m.direction = 'out' and m.status in ('sent', 'delivered', 'read')
         and m.created_at >= now() - interval '30 days'
    ),
    'emails_sent_30d', (
      select count(*) from public.email_messages e
       where e.status in ('sent', 'delivered', 'opened', 'clicked')
         and e.created_at >= now() - interval '30 days'
    ),
    'campaigns_active', (
      select count(*) from public.campaigns c
       where c.status in ('approved', 'scheduled', 'sending')
         and (p_campus_id is null or c.campus_id is null or c.campus_id = p_campus_id)
    ),
    'campaigns_pending_approval', (
      select count(*) from public.campaigns c
       where c.status = 'pending_approval'
         and (p_campus_id is null or c.campus_id is null or c.campus_id = p_campus_id)
    ),
    'replies_waiting', (
      select count(*) from public.messages m
       where m.direction = 'in' and m.crm_read_at is null
    ),
    'follow_ups_due', (select count(*) from fam where next_follow_up_at is not null and next_follow_up_at <= now()),
    'no_contact_30d', (select count(*) from fam, stale where fam.is_active and (fam.last_contact_at is null or fam.last_contact_at < now() - make_interval(days => stale.days))),
    'tasks_due_today', (
      select count(*) from public.tasks t
       where t.status = 'open'
         and (t.due_at at time zone 'Africa/Gaborone')::date = (now() at time zone 'Africa/Gaborone')::date
         and (p_campus_id is null or t.campus_id = p_campus_id)
    ),
    'tasks_overdue', (
      select count(*) from public.tasks t
       where t.status = 'open' and t.due_at < now()
         and (p_campus_id is null or t.campus_id = p_campus_id)
    ),
    'tasks_upcoming', (
      select count(*) from public.tasks t
       where t.status = 'open' and t.due_at > now() and t.due_at <= now() + interval '7 days'
         and (p_campus_id is null or t.campus_id = p_campus_id)
    ),
    'opportunities', (
      select coalesce(jsonb_agg(jsonb_build_object('type_code', type_code, 'families', n) order by n desc), '[]'::jsonb)
        from (
          select o.type_code, count(distinct o.family_id) as n
            from public.opportunities o
           where o.status in ('identified', 'contacted', 'interested')
             and (p_campus_id is null or o.campus_id = p_campus_id)
           group by o.type_code
        ) t
    ),
    'multiple_children_one_enrolled', (select count(*) from fam where student_count >= 2 and enrolled_count = 1),
    'reenrolment_outstanding', (select count(*) from fam where reenrolment_outstanding > 0),
    'events_upcoming', (
      select count(*) from public.crm_events e
       where not e.is_cancelled and e.starts_at >= now()
         and (p_campus_id is null or e.campus_id is null or e.campus_id = p_campus_id)
    )
  )
$$;

revoke execute on function public.crm_dashboard_counts(uuid) from public, anon;
grant execute on function public.crm_dashboard_counts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Lead sources, in one call
-- ---------------------------------------------------------------------------

-- Where families came from, and what became of them: enquiries, applications
-- that reached an offer, enrolments. `heard_from` is the funnel's answer;
-- families without one are counted under "not asked".
create or replace function public.crm_lead_source_report(p_campus_id uuid default null, p_from timestamptz default null)
returns table (lead_source text, families bigint, enquiries bigint, offers bigint, enrolled bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(a.heard_from, 'not_asked') as lead_source,
         count(distinct c.family_id),
         count(a.id),
         count(a.id) filter (where a.status in (
           'offer_sent', 'offer_expired', 'offer_declined', 'offer_accepted', 'payment_required', 'payment_processing',
           'paid', 'registration_incomplete', 'registration_complete', 'enrolled')),
         count(a.id) filter (where a.status = 'enrolled')
    from public.applications a
    join public.contacts c on c.id = a.contact_id
   where (p_campus_id is null or a.campus_id = p_campus_id)
     and (p_from is null or a.created_at >= p_from)
   group by coalesce(a.heard_from, 'not_asked')
   order by count(a.id) desc
$$;

revoke execute on function public.crm_lead_source_report(uuid, timestamptz) from public, anon;
grant execute on function public.crm_lead_source_report(uuid, timestamptz) to authenticated;
