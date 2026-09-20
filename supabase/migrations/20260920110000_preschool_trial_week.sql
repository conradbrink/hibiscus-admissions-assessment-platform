-- The free trial week, for the pre-schools.
--
-- A pre-school family has nothing to be assessed on; the school decides on
-- availability and on having met the child. Between the enquiry and the
-- decision the pre-schools offer a free week: the child comes each morning,
-- the teachers meet them, the parent sees the room, and only then does
-- anybody decide. Until now that week lived in somebody's head and a
-- WhatsApp thread.
--
-- A `trial_weeks` row is the offer and what came of it: the dates, who
-- invited them, whether the family confirmed, came, or did not, and a note.
-- The application does not move: it stays where a decision can be
-- recorded, its next action says "free trial week" while the week is live,
-- and the decision is taken afterwards on the review queue as before. The
-- parent is told by the same email-and-companion machinery as every other
-- moment (`trial_week_invitation`, below), and the family is tagged in the
-- CRM so a segment can find everyone who has had one.
--
-- Written under the service role from the review queue's own action, after
-- the same permission and campus checks a decision gets. Readable by anyone
-- who may read the application.

create table if not exists public.trial_weeks (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  campus_id uuid not null references public.campuses(id) on delete restrict,
  starts_on date not null,
  ends_on date not null,
  status text not null default 'invited' check (status in ('invited', 'confirmed', 'attended', 'no_show', 'cancelled')),
  -- What staff wrote when they offered it: a time to arrive, what to bring.
  note text,
  -- What the teachers said afterwards.
  outcome_note text,
  invited_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

-- One live offer per application. A cancelled or finished one may be
-- followed by another.
create unique index if not exists trial_weeks_live_idx
  on public.trial_weeks(application_id) where status in ('invited', 'confirmed');
create index if not exists trial_weeks_application_idx on public.trial_weeks(application_id, created_at desc);
create index if not exists trial_weeks_campus_starts_idx on public.trial_weeks(campus_id, starts_on);

drop trigger if exists trial_weeks_set_updated_at on public.trial_weeks;
create trigger trial_weeks_set_updated_at
  before update on public.trial_weeks
  for each row execute function public.set_updated_at();

comment on table public.trial_weeks is
  'A pre-school family''s free trial week: offered from the review queue, confirmed, attended or not. The application stays where a decision can be recorded.';

alter table public.trial_weeks enable row level security;

drop policy if exists trial_weeks_select on public.trial_weeks;
create policy trial_weeks_select on public.trial_weeks
  for select using (
    (select public.has_permission('applications.read'))
    and (select public.can_access_campus(campus_id))
  );

-- No insert or update policy: the review queue's action writes under the
-- service role after checking `decisions.override` and the campus, the
-- same as a decision.

-- ---------------------------------------------------------------------------
-- What the parent is told
-- ---------------------------------------------------------------------------

insert into public.email_templates (key, version, name, description, subject, body_html, body_text, allowed_variables, is_active, audience)
values (
  'trial_week_invitation',
  1,
  'Free trial week',
  'Sent when the review queue offers a pre-school family a free trial week. Names the dates and asks the parent to confirm.',
  '{{student_first_name}} — a free trial week at {{campus}}',
  '<p>Dear {{parent_first_name}},</p><p>We would love {{student_first_name}} to spend a <strong>free trial week</strong> with us at {{campus}}, in {{grade}}.</p><table class="details"><tr><td>When</td><td>{{trial_week_start}} to {{trial_week_end}}</td></tr><tr><td>Where</td><td>{{campus}}{{#if campus_address}}<br><span style="white-space:pre-line">{{campus_address}}</span>{{#if campus_maps_url}}<br><a href="{{campus_maps_url}}">Get directions</a>{{/if}}{{/if}}</td></tr><tr><td>Reference</td><td>{{application_reference}}</td></tr></table>{{#if trial_week_note}}<p>{{trial_week_note}}</p>{{/if}}<p>{{student_first_name}} joins the class each morning that week, meets the teachers and settles in at their own pace. There is no charge and nothing to sign; at the end of the week we talk about what comes next.</p><p>Please reply to this email to confirm{{#if campus_whatsapp}}, or message us on WhatsApp at {{campus_whatsapp}}{{/if}}. If the dates do not suit, tell us and we will find a week that does.</p><p><a href="{{next_step_link}}" class="button">See your enquiry</a></p><p>We look forward to welcoming you both.</p><p>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\nWe would love {{student_first_name}} to spend a free trial week with us at {{campus}}, in {{grade}}.\n\nWhen: {{trial_week_start}} to {{trial_week_end}}\nWhere: {{campus}}\n{{#if campus_address}}{{campus_address}}{{#if campus_maps_url}}\nDirections: {{campus_maps_url}}{{/if}}\n{{/if}}Reference: {{application_reference}}\n\n{{#if trial_week_note}}{{trial_week_note}}\n\n{{/if}}{{student_first_name}} joins the class each morning that week, meets the teachers and settles in at their own pace. There is no charge and nothing to sign; at the end of the week we talk about what comes next.\n\nPlease reply to this email to confirm{{#if campus_whatsapp}}, or message us on WhatsApp at {{campus_whatsapp}}{{/if}}. If the dates do not suit, tell us and we will find a week that does.\n\nYou can see your enquiry here:\n{{next_step_link}}\n\nWe look forward to welcoming you both.\n\nHibiscus International Schools Admissions',
  array['parent_first_name','student_first_name','campus','grade','trial_week_start','trial_week_end','trial_week_note','campus_address','campus_maps_url','campus_whatsapp','application_reference','next_step_link'],
  true,
  'parent'
)
on conflict (key, version) do nothing;

-- Its WhatsApp companion. Inactive with no provider id until the wording is
-- approved and somebody pastes the id in, like every companion before it;
-- until then the moment goes by email alone.
insert into public.message_templates (key, name, language, body_preview, parameters, button_link, link_purpose, is_active, audience)
values (
  'trial_week_invitation',
  'Free trial week',
  'en',
  E'Hi {{1}}, we would love {{2}} to spend a free trial week with us at {{3}}, from {{4}} to {{5}}. There is no charge. Please reply to confirm, or tell us if another week suits better. Tap below to see your enquiry.',
  array['parent_first_name','student_first_name','campus','trial_week_start','trial_week_end'],
  true,
  'next_step',
  false,
  'applicant'
)
on conflict (key) do nothing;
