-- Email templates and the log of every email sent.
--
-- No wording lives in code. A template is a subject and two bodies (HTML and
-- plain text) with {{variables}}; an administrator with templates.write can
-- change any of it without a deploy. Every send records the fully rendered
-- message, so the timeline shows exactly what a parent received even after
-- the template has since been edited.

create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  -- The key code sends by: 'booking_confirmed'. Stable across versions.
  key text not null,
  version int not null default 1,
  name text not null,
  description text,
  subject text not null,
  body_html text not null,
  body_text text not null,
  -- The variables this template may use, validated at save time in the
  -- editor. A typo in a variable name is caught there, not in a parent's
  -- inbox as a literal "{{parent_frist_name}}".
  allowed_variables text[] not null default '{}'::text[],
  is_active boolean not null default true,
  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (key, version)
);

drop trigger if exists email_templates_set_updated_at on public.email_templates;
create trigger email_templates_set_updated_at
  before update on public.email_templates
  for each row execute function public.set_updated_at();

-- Exactly one active version per key.
create unique index if not exists email_templates_one_active_idx
  on public.email_templates(key)
  where is_active;

create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.applications(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  template_key text,
  template_version int,
  to_email text not null,
  subject text not null,
  body_html text not null,
  body_text text not null,
  provider text not null,
  provider_message_id text,
  status text not null default 'queued' check (status in (
    'queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed'
  )),
  error text,
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  bounced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists email_messages_set_updated_at on public.email_messages;
create trigger email_messages_set_updated_at
  before update on public.email_messages
  for each row execute function public.set_updated_at();

create index if not exists email_messages_application_idx
  on public.email_messages(application_id, created_at desc);
create index if not exists email_messages_provider_id_idx
  on public.email_messages(provider_message_id)
  where provider_message_id is not null;
create index if not exists email_messages_created_idx
  on public.email_messages(created_at desc);

-- Publishing a new version: insert it, retire the old one, activate the new
-- one — atomically, so there is never a moment with no active template (an
-- email job arriving in that moment would fail as "no template", and that
-- failure is not retried).
create or replace function public.publish_email_template(
  p_key text,
  p_name text,
  p_description text,
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
  v_allowed text[];
  v_next int;
  v_id uuid;
begin
  if not public.has_permission('templates.write') then
    raise exception 'permission_denied';
  end if;

  select allowed_variables, max(version) + 1
    into v_allowed, v_next
    from public.email_templates
   where key = p_key
   group by allowed_variables
   order by max(version) desc
   limit 1;
  if v_next is null then
    raise exception 'template_key_unknown';
  end if;

  update public.email_templates set is_active = false where key = p_key and is_active;

  insert into public.email_templates (
    key, version, name, description, subject, body_html, body_text, allowed_variables, is_active, created_by
  ) values (
    p_key, v_next, p_name, p_description, p_subject, p_body_html, p_body_text, v_allowed, true, auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.publish_email_template(text, text, text, text, text, text) from public, anon;
grant execute on function public.publish_email_template(text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.email_templates enable row level security;
alter table public.email_messages enable row level security;

drop policy if exists email_templates_select on public.email_templates;
create policy email_templates_select on public.email_templates
  for select using ((select public.current_staff_id()) is not null);

drop policy if exists email_templates_insert on public.email_templates;
create policy email_templates_insert on public.email_templates
  for insert with check (
    (select public.has_permission('templates.write'))
    and created_by = (select auth.uid())
  );

drop policy if exists email_templates_update on public.email_templates;
create policy email_templates_update on public.email_templates
  for update using ((select public.has_permission('templates.write')));

-- No delete. A version that was ever active was sent to somebody; it stays.

drop policy if exists email_messages_select on public.email_messages;
create policy email_messages_select on public.email_messages
  for select using (
    (select public.has_permission('applications.read'))
    and (
      application_id is null
      or exists (
        select 1 from public.applications a
        where a.id = email_messages.application_id
          and (select public.can_access_campus(a.campus_id))
      )
    )
  );

-- Messages are written by the email service under the service role and
-- updated by the provider webhook. No write policies for authenticated.

-- ---------------------------------------------------------------------------
-- Seed: Phase 1 templates
-- ---------------------------------------------------------------------------
--
-- Starting wording. Every one of these is expected to be edited by the
-- school before launch; that is the point of keeping them here.

insert into public.email_templates (key, name, description, subject, body_text, body_html, allowed_variables)
values
(
  'enquiry_received',
  'Enquiry received',
  'Sent immediately after a parent submits an enquiry that has not yet been booked into a session.',
  'We''ve received your enquiry for {{student_first_name}}',
  E'Dear {{parent_first_name}},\n\nThank you for your interest in Hibiscus Schools. We have received your enquiry for {{student_first_name}} to join {{campus}} in {{grade}}.\n\nYour reference is {{application_reference}}. Please keep it for any correspondence.\n\nYour next step is to book an assessment. It takes about a minute:\n{{next_step_link}}\n\nWarm regards,\nHibiscus Schools Admissions',
  '<p>Dear {{parent_first_name}},</p><p>Thank you for your interest in Hibiscus Schools. We have received your enquiry for <strong>{{student_first_name}}</strong> to join <strong>{{campus}}</strong> in <strong>{{grade}}</strong>.</p><p>Your reference is <strong>{{application_reference}}</strong>. Please keep it for any correspondence.</p><p>Your next step is to book an assessment. It takes about a minute.</p><p><a href="{{next_step_link}}" class="button">Book my assessment</a></p><p>Warm regards,<br>Hibiscus Schools Admissions</p>',
  array['parent_first_name','student_first_name','campus','grade','application_reference','next_step_link']
),
(
  'preschool_enquiry_received',
  'Pre-school enquiry received',
  'Sent for Nursery to Pre-Reception enquiries, which do not require an assessment.',
  'We''ve received your enquiry for {{student_first_name}}',
  E'Dear {{parent_first_name}},\n\nThank you for your interest in Hibiscus Schools. We have received your enquiry for {{student_first_name}} to join {{campus}} in {{grade}}.\n\nYour reference is {{application_reference}}.\n\nChildren joining {{grade}} do not sit an assessment. Our admissions team will review availability and be in touch shortly. If you would like to see the campus first, you can book a visit here:\n{{next_step_link}}\n\nWarm regards,\nHibiscus Schools Admissions',
  '<p>Dear {{parent_first_name}},</p><p>Thank you for your interest in Hibiscus Schools. We have received your enquiry for <strong>{{student_first_name}}</strong> to join <strong>{{campus}}</strong> in <strong>{{grade}}</strong>.</p><p>Your reference is <strong>{{application_reference}}</strong>.</p><p>Children joining {{grade}} do not sit an assessment. Our admissions team will review availability and be in touch shortly. If you would like to see the campus first, you can book a visit.</p><p><a href="{{next_step_link}}" class="button">Book a visit</a></p><p>Warm regards,<br>Hibiscus Schools Admissions</p>',
  array['parent_first_name','student_first_name','campus','grade','application_reference','next_step_link']
),
(
  'booking_confirmed',
  'Assessment booking confirmed',
  'Sent when an assessment session is booked. Carries a calendar invitation.',
  '{{student_first_name}}''s assessment is booked — {{assessment_date}} at {{assessment_time}}',
  E'Dear {{parent_first_name}},\n\n{{student_first_name}}''s assessment is booked.\n\nWhen: {{assessment_date}} at {{assessment_time}}\nWhere: {{campus}}{{#if location}}, {{location}}{{/if}}\nReference: {{application_reference}}\n\nPlease arrive ten minutes early. On the day, just give reception your name or reference — there is no paperwork to fill in.\n\nYou can view or change your booking here:\n{{next_step_link}}\n\nWe look forward to meeting you both.\n\nHibiscus Schools Admissions',
  '<p>Dear {{parent_first_name}},</p><p><strong>{{student_first_name}}''s assessment is booked.</strong></p><table class="details"><tr><td>When</td><td>{{assessment_date}} at {{assessment_time}}</td></tr><tr><td>Where</td><td>{{campus}}{{#if location}}, {{location}}{{/if}}</td></tr><tr><td>Reference</td><td>{{application_reference}}</td></tr></table><p>Please arrive ten minutes early. On the day, just give reception your name or reference — there is no paperwork to fill in.</p><p><a href="{{next_step_link}}" class="button">View my booking</a></p><p>We look forward to meeting you both.</p><p>Hibiscus Schools Admissions</p>',
  array['parent_first_name','student_first_name','campus','grade','location','assessment_date','assessment_time','application_reference','next_step_link']
),
(
  'what_to_expect',
  'What to expect at the assessment',
  'Sent an hour after booking. Explains the day so the child arrives relaxed.',
  'What to expect at {{student_first_name}}''s assessment',
  E'Dear {{parent_first_name}},\n\nA little about what happens on {{assessment_date}}.\n\n{{student_first_name}} will complete a short, age-appropriate academic assessment on a computer in our learning centre. It covers English and Mathematics, with some reasoning activities for older children. It usually takes between 45 and 90 minutes depending on the grade.\n\nThere is nothing to prepare or revise. A good night''s sleep and breakfast are the only preparation we recommend.\n\nAfter the assessment you will receive {{student_first_name}}''s learning profile by email — a summary of strengths and areas to develop that is yours to keep, whatever the outcome.\n\nSee you on {{assessment_date}} at {{assessment_time}}.\n\nHibiscus Schools Admissions',
  '<p>Dear {{parent_first_name}},</p><p>A little about what happens on {{assessment_date}}.</p><p>{{student_first_name}} will complete a short, age-appropriate academic assessment on a computer in our learning centre. It covers English and Mathematics, with some reasoning activities for older children. It usually takes between 45 and 90 minutes depending on the grade.</p><p>There is nothing to prepare or revise. A good night''s sleep and breakfast are the only preparation we recommend.</p><p>After the assessment you will receive {{student_first_name}}''s learning profile by email — a summary of strengths and areas to develop that is yours to keep, whatever the outcome.</p><p>See you on {{assessment_date}} at {{assessment_time}}.</p><p>Hibiscus Schools Admissions</p>',
  array['parent_first_name','student_first_name','campus','assessment_date','assessment_time','next_step_link']
),
(
  'assessment_reminder_48h',
  'Assessment reminder — 48 hours',
  'Sent two days before the session, only if the booking is still live.',
  'Reminder: {{student_first_name}}''s assessment is on {{assessment_date}}',
  E'Dear {{parent_first_name}},\n\nA reminder that {{student_first_name}}''s assessment is on {{assessment_date}} at {{assessment_time}}, at {{campus}}.\n\nIf you need to change the time, you can do so here:\n{{next_step_link}}\n\nHibiscus Schools Admissions',
  '<p>Dear {{parent_first_name}},</p><p>A reminder that {{student_first_name}}''s assessment is on <strong>{{assessment_date}} at {{assessment_time}}</strong>, at {{campus}}.</p><p>If you need to change the time, you can do so below.</p><p><a href="{{next_step_link}}" class="button">View my booking</a></p><p>Hibiscus Schools Admissions</p>',
  array['parent_first_name','student_first_name','campus','assessment_date','assessment_time','next_step_link']
),
(
  'assessment_reminder_day',
  'Assessment reminder — today',
  'Sent on the morning of the session.',
  'Today: {{student_first_name}}''s assessment at {{assessment_time}}',
  E'Dear {{parent_first_name}},\n\n{{student_first_name}}''s assessment is today at {{assessment_time}}, at {{campus}}{{#if location}}, {{location}}{{/if}}.\n\nGive reception your name or reference {{application_reference}} when you arrive. See you soon.\n\nHibiscus Schools Admissions',
  '<p>Dear {{parent_first_name}},</p><p>{{student_first_name}}''s assessment is <strong>today at {{assessment_time}}</strong>, at {{campus}}{{#if location}}, {{location}}{{/if}}.</p><p>Give reception your name or reference <strong>{{application_reference}}</strong> when you arrive. See you soon.</p><p>Hibiscus Schools Admissions</p>',
  array['parent_first_name','student_first_name','campus','location','assessment_time','application_reference']
),
(
  'no_show_reschedule',
  'Missed assessment — rebook',
  'Sent when staff mark a booking as a no-show.',
  'We missed {{student_first_name}} today — let''s find another time',
  E'Dear {{parent_first_name}},\n\nWe had {{student_first_name}} booked for an assessment today but did not see you. These things happen.\n\nYou can choose another time here — it takes a minute:\n{{next_step_link}}\n\nIf something has changed and you no longer wish to proceed, you need not do anything.\n\nHibiscus Schools Admissions',
  '<p>Dear {{parent_first_name}},</p><p>We had {{student_first_name}} booked for an assessment today but did not see you. These things happen.</p><p>You can choose another time below — it takes a minute.</p><p><a href="{{next_step_link}}" class="button">Rebook the assessment</a></p><p>If something has changed and you no longer wish to proceed, you need not do anything.</p><p>Hibiscus Schools Admissions</p>',
  array['parent_first_name','student_first_name','next_step_link']
),
(
  'enquiry_nudge',
  'Enquiry not yet booked — nudge',
  'Sent if an assessment-track enquiry has no booking after the configured delay.',
  'Ready to book {{student_first_name}}''s assessment?',
  E'Dear {{parent_first_name}},\n\nYou enquired about {{student_first_name}} joining {{campus}} but have not yet chosen an assessment time. Places fill up, so it is worth booking early:\n{{next_step_link}}\n\nIf you have any questions, simply reply to this email.\n\nHibiscus Schools Admissions',
  '<p>Dear {{parent_first_name}},</p><p>You enquired about {{student_first_name}} joining {{campus}} but have not yet chosen an assessment time. Places fill up, so it is worth booking early.</p><p><a href="{{next_step_link}}" class="button">Book my assessment</a></p><p>If you have any questions, simply reply to this email.</p><p>Hibiscus Schools Admissions</p>',
  array['parent_first_name','student_first_name','campus','next_step_link']
),
(
  'visit_confirmed',
  'School visit confirmed',
  'Sent when a visit session is booked.',
  'Your visit to {{campus}} is booked — {{assessment_date}} at {{assessment_time}}',
  E'Dear {{parent_first_name}},\n\nYour visit to {{campus}} is booked for {{assessment_date}} at {{assessment_time}}.\n\nReference: {{application_reference}}\n\nWe look forward to showing you around.\n\nHibiscus Schools Admissions',
  '<p>Dear {{parent_first_name}},</p><p>Your visit to <strong>{{campus}}</strong> is booked for <strong>{{assessment_date}} at {{assessment_time}}</strong>.</p><p>Reference: {{application_reference}}</p><p>We look forward to showing you around.</p><p>Hibiscus Schools Admissions</p>',
  array['parent_first_name','student_first_name','campus','assessment_date','assessment_time','application_reference','next_step_link']
),
(
  'callback_received',
  'Callback request received',
  'Sent when a parent asks to be called.',
  'We''ll call you about {{student_first_name}}',
  E'Dear {{parent_first_name}},\n\nThank you. A member of our admissions team will call you on the number you gave us, usually within one working day.\n\nReference: {{application_reference}}\n\nHibiscus Schools Admissions',
  '<p>Dear {{parent_first_name}},</p><p>Thank you. A member of our admissions team will call you on the number you gave us, usually within one working day.</p><p>Reference: {{application_reference}}</p><p>Hibiscus Schools Admissions</p>',
  array['parent_first_name','student_first_name','application_reference']
),
(
  'fresh_link',
  'Fresh link',
  'Sent when a parent asks for a new link from the website.',
  'Your Hibiscus Schools link',
  E'Dear {{parent_first_name}},\n\nHere is a fresh link to {{student_first_name}}''s application:\n{{next_step_link}}\n\nIf you did not ask for this, you can ignore this email.\n\nHibiscus Schools Admissions',
  '<p>Dear {{parent_first_name}},</p><p>Here is a fresh link to {{student_first_name}}''s application.</p><p><a href="{{next_step_link}}" class="button">Continue</a></p><p>If you did not ask for this, you can ignore this email.</p><p>Hibiscus Schools Admissions</p>',
  array['parent_first_name','student_first_name','next_step_link']
)
on conflict (key, version) do nothing;
