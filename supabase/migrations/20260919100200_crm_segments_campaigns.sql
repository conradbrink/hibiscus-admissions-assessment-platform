-- Audiences, and writing to them.
--
-- A segment is a saved set of rules over families ("Block 7, Stage 5, not in
-- robotics"), evaluated when it is looked at rather than stored as a list,
-- so it is always today's answer. A campaign is one message to one segment
-- on one or both channels, with the approval a bulk message needs and the
-- recipient list frozen at the moment it is prepared, so what was sent can
-- always be read back.
--
-- The email a campaign sends is authored in the campaign itself, by the
-- person writing it, which keeps the rule that no wording lives in code; the
-- WhatsApp half is a `message_templates` row, because WhatsApp sends nothing
-- that Meta has not approved. Both halves go through the senders that
-- already exist — `lib/email` and `lib/messaging` — so a campaign message is
-- recorded in the same two logs, and shows on the family, exactly as a
-- re-enrolment ask does.

-- ---------------------------------------------------------------------------
-- Every family, with the facts a rule can ask about
-- ---------------------------------------------------------------------------

-- The one view the Families list, the segment builder, the campaign
-- recipient count and the dashboard read. Security invoker: a row appears
-- only when the caller may see the family, and the children it counts are
-- the children they may see.
create or replace view public.v_crm_family_facts
with (security_invoker = true)
as
select
  f.id as family_id,
  f.family_code,
  f.display_name,
  f.campus_id,
  c.name as campus_name,
  f.lifecycle_stage,
  f.lifecycle_manual,
  f.assigned_staff_id,
  f.lead_source,
  f.tags,
  f.preferred_channel,
  f.last_contact_at,
  f.next_follow_up_at,
  f.created_at,
  f.is_active,
  f.referred_by_family_id,
  pc.id as primary_contact_id,
  pc.first_name as primary_first_name,
  pc.last_name as primary_last_name,
  pc.email as primary_email,
  pc.mobile as primary_mobile,
  pc.mobile_normalised as primary_mobile_normalised,
  pc.whatsapp_opt_in as primary_whatsapp_opt_in,
  pc.marketing_email_consent as primary_marketing_email_consent,
  pc.marketing_whatsapp_consent as primary_marketing_whatsapp_consent,
  pc.sms_consent as primary_sms_consent,
  coalesce(st.student_count, 0)::int as student_count,
  coalesce(st.enrolled_count, 0)::int as enrolled_count,
  coalesce(st.grade_sorts, '{}'::int[]) as grade_sorts,
  coalesce(st.grade_ids, '{}'::uuid[]) as grade_ids,
  coalesce(st.campus_ids, '{}'::uuid[]) as student_campus_ids,
  coalesce(st.student_ids, '{}'::uuid[]) as student_ids,
  coalesce(st.statuses, '{}'::text[]) as student_statuses,
  coalesce(it.codes, '{}'::text[]) as registered_item_codes,
  coalesce(op.types, '{}'::text[]) as open_opportunity_types,
  coalesce(op.n, 0)::int as open_opportunity_count,
  coalesce(re.outstanding, 0)::int as reenrolment_outstanding,
  coalesce(ap.n, 0)::int as application_count,
  coalesce(ap.open_n, 0)::int as open_application_count,
  ap.latest_status as latest_application_status,
  coalesce(tk.open_tasks, 0)::int as open_task_count
from public.families f
left join public.campuses c on c.id = f.campus_id
left join public.contacts pc on pc.id = f.primary_contact_id
left join lateral (
  select count(*) as student_count,
         count(*) filter (where s.status in ('onboarding', 'active', 'on_leave')) as enrolled_count,
         array_remove(array_agg(g.sort_order), null) as grade_sorts,
         array_remove(array_agg(s.current_grade_id), null) as grade_ids,
         array_agg(distinct s.current_campus_id) as campus_ids,
         array_agg(s.id) as student_ids,
         array_agg(distinct s.status) as statuses
    from public.students s
    left join public.grades g on g.id = s.current_grade_id
   where s.family_id = f.id
) st on true
left join lateral (
  select array_agg(distinct oi.code) as codes
    from public.student_optional_selections sel
    join public.optional_items oi on oi.id = sel.item_id
    join public.students s on s.id = sel.student_id
   where s.family_id = f.id
     and sel.status in ('selected', 'paid')
) it on true
left join lateral (
  select array_agg(distinct o.type_code) as types, count(*) as n
    from public.opportunities o
   where o.family_id = f.id
     and o.status in ('identified', 'contacted', 'interested')
) op on true
left join lateral (
  select count(*) as outstanding
    from public.reenrolment_responses rr
    join public.reenrolment_cycles rc on rc.id = rr.cycle_id
    join public.students s on s.id = rr.student_id
   where s.family_id = f.id
     and rc.status = 'open'
     and rr.answered_at is null
) re on true
left join lateral (
  select count(*) as n,
         count(*) filter (where a.status not in ('enrolled', 'withdrawn', 'declined', 'offer_declined')) as open_n,
         (array_agg(a.status order by a.created_at desc))[1] as latest_status
    from public.applications a
    join public.contacts ct on ct.id = a.contact_id
   where ct.family_id = f.id
) ap on true
left join lateral (
  select count(*) as open_tasks
    from public.tasks t
   where t.status = 'open'
     and (
       (t.student_id is not null and t.student_id = any (coalesce(st.student_ids, '{}'::uuid[])))
       or (t.application_id is not null and public.crm_family_of_application(t.application_id) = f.id)
     )
) tk on true
where f.merged_into_id is null;

comment on view public.v_crm_family_facts is
  'One row per live family with everything a list, a segment rule or a campaign needs to know. Security invoker.';

-- `crm_family_of_application` is used by the view above under the caller's
-- rights; it was service-role only, which would make the view refuse every
-- task. It is security invoker, so under a person it answers only for an
-- application their own policies let them read: staff may call it.
grant execute on function public.crm_family_of_application(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Segments
-- ---------------------------------------------------------------------------

-- `rules` is a JSON array of {field, op, value}, all of which must hold.
-- The fields are the columns of `v_crm_family_facts`; `web/lib/crm/segments.ts`
-- is the list of fields and operators offered and the code that turns them
-- into a query, and it is tested. A rule naming a field the code does not
-- know is refused at save time, never silently ignored.
create table if not exists public.segments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  description text,
  -- Null is "every campus the viewer may see". A campus segment is scoped
  -- like everything else at that campus.
  campus_id uuid references public.campuses(id) on delete cascade,
  rules jsonb not null default '[]'::jsonb,
  match_count int,
  counted_at timestamptz,
  is_active boolean not null default true,
  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists segments_campus_idx on public.segments(campus_id) where campus_id is not null;

drop trigger if exists segments_set_updated_at on public.segments;
create trigger segments_set_updated_at
  before update on public.segments
  for each row execute function public.set_updated_at();

comment on table public.segments is
  'A saved audience: rules over families, evaluated when looked at. The count is a cache with a timestamp, never the truth.';

-- ---------------------------------------------------------------------------
-- Campaigns
-- ---------------------------------------------------------------------------

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 160),
  description text,
  campus_id uuid references public.campuses(id) on delete cascade,
  segment_id uuid references public.segments(id) on delete set null,
  channel text not null check (channel in ('email', 'whatsapp', 'both')),
  -- Which kind of message this is. Three of these are the school's
  -- "high-risk" communications and need the sensitive approval.
  category text not null default 'general' check (category in (
    'general', 'promotion', 'event', 'reenrolment', 'fee_notice', 'policy', 'announcement'
  )),
  -- The email, authored here. Variables are the family's, listed in
  -- web/lib/crm/campaigns/variables.ts, and an unsubscribe link is appended
  -- by the sender to every marketing email whatever the author wrote.
  email_subject text,
  email_body_html text,
  email_body_text text,
  -- The WhatsApp half: an approved template, and which family fact fills
  -- each of its parameters.
  message_template_key text references public.message_templates(key) on delete set null,
  whatsapp_variables jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in (
    'draft', 'pending_approval', 'approved', 'scheduled', 'sending', 'sent', 'paused', 'cancelled'
  )),
  scheduled_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid references public.staff_profiles(id) on delete set null,
  submitted_by uuid references public.staff_profiles(id) on delete set null,
  submitted_at timestamptz,
  approved_by uuid references public.staff_profiles(id) on delete set null,
  approved_at timestamptz,
  approval_note text,
  rejected_by uuid references public.staff_profiles(id) on delete set null,
  rejected_at timestamptz,
  rejection_reason text,
  -- The recipient count as it stood when the list was prepared. The rows
  -- are in campaign_recipients; these are the figures the approver saw.
  prepared_at timestamptz,
  recipients_total int,
  recipients_email int,
  recipients_whatsapp int,
  excluded_count int,
  exclusions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists campaigns_status_idx on public.campaigns(status);
create index if not exists campaigns_campus_idx on public.campaigns(campus_id) where campus_id is not null;
create index if not exists campaigns_scheduled_idx on public.campaigns(scheduled_at) where status = 'scheduled';
create index if not exists campaigns_created_idx on public.campaigns(created_at desc);

drop trigger if exists campaigns_set_updated_at on public.campaigns;
create trigger campaigns_set_updated_at
  before update on public.campaigns
  for each row execute function public.set_updated_at();

comment on table public.campaigns is
  'One bulk message to one audience. Approved by a second person, sent by the drain, never edited once it has left draft.';

create table if not exists public.campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  channel text not null check (channel in ('email', 'whatsapp')),
  status text not null default 'pending' check (status in ('pending', 'excluded', 'sent', 'skipped', 'failed')),
  exclusion_reason text,
  email_message_id uuid references public.email_messages(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (campaign_id, contact_id, channel)
);

create index if not exists campaign_recipients_campaign_idx on public.campaign_recipients(campaign_id, status);
create index if not exists campaign_recipients_family_idx on public.campaign_recipients(family_id);
create index if not exists campaign_recipients_pending_idx on public.campaign_recipients(campaign_id) where status = 'pending';

comment on table public.campaign_recipients is
  'The recipient list a campaign was prepared with, frozen: who was in, who was left out and why, and what each send became.';

-- A note may point at a campaign.
alter table public.crm_notes
  drop constraint if exists crm_notes_campaign_id_fkey;
alter table public.crm_notes
  add constraint crm_notes_campaign_id_fkey
  foreign key (campaign_id) references public.campaigns(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- What a campaign may become, and who may make it so
-- ---------------------------------------------------------------------------

-- RLS says who may touch the row. This says which moves are legal and who
-- may make each one, because RLS cannot see which column changed:
--
--   · sending and sent are the drain's alone;
--   · approving needs crm.campaigns.approve, the sensitive categories need
--     crm.campaigns.approve_sensitive as well, and — while the school's
--     approval setting is on — never by the person who wrote it;
--   · scheduling needs an approval behind it;
--   · the message is frozen once it has left draft.
create or replace function public.campaigns_guard_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_label text;
  v_requires_second boolean;
  v_sensitive boolean := new.category in ('fee_notice', 'policy', 'announcement');
begin
  if v_actor is not null then
    select email into v_label from public.staff_profiles where id = v_actor;
  end if;

  -- The message is what was approved. Change it and the approval is void, so
  -- the only edit allowed after draft is the one back to draft.
  if tg_op = 'UPDATE' and old.status <> 'draft' and new.status <> 'draft' and (
       new.email_subject is distinct from old.email_subject
    or new.email_body_html is distinct from old.email_body_html
    or new.email_body_text is distinct from old.email_body_text
    or new.message_template_key is distinct from old.message_template_key
    or new.whatsapp_variables is distinct from old.whatsapp_variables
    or new.segment_id is distinct from old.segment_id
    or new.channel is distinct from old.channel
    or new.category is distinct from old.category
    or new.campus_id is distinct from old.campus_id
  ) then
    raise exception 'campaign_locked';
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status in ('sending', 'sent') and v_actor is not null then
      raise exception 'campaign_status_engine_only';
    end if;

    if new.status = 'approved' then
      if v_actor is not null then
        if not public.has_permission('crm.campaigns.approve') then
          raise exception 'permission_denied';
        end if;
        if v_sensitive and not public.has_permission('crm.campaigns.approve_sensitive') then
          raise exception 'campaign_needs_sensitive_approval';
        end if;
        select coalesce((value = 'true'::jsonb), true) into v_requires_second
          from public.settings where key = 'crm_campaign_approval_required';
        if coalesce(v_requires_second, true) and new.created_by = v_actor and not public.has_permission('admin') then
          raise exception 'campaign_self_approval';
        end if;
        new.approved_by := v_actor;
        new.approved_at := now();
      end if;
      if old.status not in ('pending_approval', 'draft') then
        raise exception 'campaign_not_awaiting_approval';
      end if;
    end if;

    if new.status = 'scheduled' and old.status not in ('approved', 'paused') then
      raise exception 'campaign_not_approved';
    end if;
    if new.status = 'scheduled' and new.scheduled_at is null then
      raise exception 'campaign_needs_a_time';
    end if;

    if new.status = 'pending_approval' then
      new.submitted_by := coalesce(v_actor, new.submitted_by);
      new.submitted_at := now();
    end if;

    if new.status = 'draft' then
      -- Back to the drawing board: the approval that was given no longer
      -- applies to what will be written next.
      new.approved_by := null;
      new.approved_at := null;
      new.submitted_by := null;
      new.submitted_at := null;
      new.scheduled_at := null;
    end if;

    if new.status = 'cancelled' and old.status in ('sent') then
      raise exception 'campaign_already_sent';
    end if;

    insert into public.audit_log (actor_type, actor_id, actor_label, action, entity_type, entity_id, before, after)
    values (case when v_actor is null then 'system' else 'staff' end, v_actor, coalesce(v_label, 'System'),
            'campaign.' || new.status, 'campaign', new.id,
            jsonb_build_object('status', old.status),
            jsonb_build_object('status', new.status, 'name', new.name, 'category', new.category, 'scheduled_at', new.scheduled_at,
                               'recipients_total', new.recipients_total, 'reason', new.rejection_reason));
  end if;

  return new;
end;
$$;

revoke all on function public.campaigns_guard_transition() from public, anon, authenticated;

drop trigger if exists campaigns_guard_transition on public.campaigns;
create trigger campaigns_guard_transition
  before update on public.campaigns
  for each row execute function public.campaigns_guard_transition();

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

alter table public.segments enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_recipients enable row level security;

drop policy if exists segments_select on public.segments;
create policy segments_select on public.segments
  for select using (
    (select public.has_permission('crm.read'))
    and (campus_id is null or (select public.can_access_campus(campus_id)))
  );

drop policy if exists segments_insert on public.segments;
create policy segments_insert on public.segments
  for insert with check (
    (select public.has_permission('crm.campaigns.write'))
    and (campus_id is null or (select public.can_access_campus(campus_id)))
    and created_by = (select auth.uid())
  );

drop policy if exists segments_update on public.segments;
create policy segments_update on public.segments
  for update using (
    (select public.has_permission('crm.campaigns.write'))
    and (campus_id is null or (select public.can_access_campus(campus_id)))
  );

drop policy if exists segments_delete on public.segments;
create policy segments_delete on public.segments
  for delete using (
    (select public.has_permission('crm.campaigns.write'))
    and (campus_id is null or (select public.can_access_campus(campus_id)))
    -- Not while a campaign names it; the foreign key would set that to null
    -- and lose what the campaign was sent to.
    and not exists (select 1 from public.campaigns c where c.segment_id = segments.id)
  );

drop policy if exists campaigns_select on public.campaigns;
create policy campaigns_select on public.campaigns
  for select using (
    (select public.has_permission('crm.read'))
    and (campus_id is null or (select public.can_access_campus(campus_id)))
  );

drop policy if exists campaigns_insert on public.campaigns;
create policy campaigns_insert on public.campaigns
  for insert with check (
    (select public.has_permission('crm.campaigns.write'))
    and (campus_id is null or (select public.can_access_campus(campus_id)))
    and created_by = (select auth.uid())
    and status = 'draft'
  );

-- Writers and approvers both update the row; the trigger above decides which
-- of their changes are legal.
drop policy if exists campaigns_update on public.campaigns;
create policy campaigns_update on public.campaigns
  for update using (
    (
      (select public.has_permission('crm.campaigns.write'))
      or (select public.has_permission('crm.campaigns.approve'))
    )
    and (campus_id is null or (select public.can_access_campus(campus_id)))
  );

drop policy if exists campaigns_delete on public.campaigns;
create policy campaigns_delete on public.campaigns
  for delete using (
    (select public.has_permission('crm.campaigns.write'))
    and (campus_id is null or (select public.can_access_campus(campus_id)))
    and status = 'draft'
  );

-- The list is the drain's to write. Staff read it through the campaign.
drop policy if exists campaign_recipients_select on public.campaign_recipients;
create policy campaign_recipients_select on public.campaign_recipients
  for select using (
    exists (select 1 from public.campaigns c where c.id = campaign_recipients.campaign_id)
  );

-- ---------------------------------------------------------------------------
-- What became of a campaign, in one call
-- ---------------------------------------------------------------------------

create or replace function public.crm_campaign_stats(p_campaign_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with r as (
    select cr.*, e.status as email_status, m.status as message_status, m.contact_id as m_contact
      from public.campaign_recipients cr
      left join public.email_messages e on e.id = cr.email_message_id
      left join public.messages m on m.id = cr.message_id
     where cr.campaign_id = p_campaign_id
  ), c as (
    select started_at from public.campaigns where id = p_campaign_id
  )
  select jsonb_build_object(
    'total', (select count(*) from r),
    'pending', (select count(*) from r where status = 'pending'),
    'excluded', (select count(*) from r where status = 'excluded'),
    'sent', (select count(*) from r where status = 'sent'),
    'skipped', (select count(*) from r where status = 'skipped'),
    'failed', (select count(*) from r where status = 'failed'),
    'email', jsonb_build_object(
      'sent', (select count(*) from r where channel = 'email' and status = 'sent'),
      'delivered', (select count(*) from r where channel = 'email' and email_status in ('delivered', 'opened', 'clicked')),
      'opened', (select count(*) from r where channel = 'email' and email_status in ('opened', 'clicked')),
      'clicked', (select count(*) from r where channel = 'email' and email_status = 'clicked'),
      'bounced', (select count(*) from r where channel = 'email' and email_status = 'bounced'),
      'failed', (select count(*) from r where channel = 'email' and (status = 'failed' or email_status = 'failed'))
    ),
    'whatsapp', jsonb_build_object(
      'sent', (select count(*) from r where channel = 'whatsapp' and status = 'sent'),
      'delivered', (select count(*) from r where channel = 'whatsapp' and message_status in ('delivered', 'read')),
      'read', (select count(*) from r where channel = 'whatsapp' and message_status = 'read'),
      'failed', (select count(*) from r where channel = 'whatsapp' and (status = 'failed' or message_status = 'failed')),
      'replies', (
        select count(distinct m.contact_id)
          from public.messages m
          join r on r.contact_id = m.contact_id and r.channel = 'whatsapp' and r.status = 'sent'
         where m.direction = 'in'
           and m.received_at >= coalesce((select started_at from c), now())
      )
    )
  )
$$;

revoke execute on function public.crm_campaign_stats(uuid) from public, anon;
grant execute on function public.crm_campaign_stats(uuid) to authenticated;
