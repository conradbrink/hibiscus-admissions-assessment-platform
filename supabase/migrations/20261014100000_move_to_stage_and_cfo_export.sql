-- Move to stage, and the Ed-admin export for the chief financial officer.
--
-- Two things the school asked for on 14 October 2026, which share nothing but
-- a day and the permissions table.

-- ---------------------------------------------------------------------------
-- 1. Move to stage
-- ---------------------------------------------------------------------------

-- An admissions officer may move a child forward along the journey by hand —
-- to Decision, Offer, Payment or Registration — skipping the steps between,
-- with a reason. A family at the desk who has paid already, or a child the
-- school has decided need not sit the assessment, had no way on: every button
-- waited for the one before it. The moves themselves live in code
-- (`OVERRIDE_TRANSITIONS` in web/lib/workflow/states.ts and
-- web/lib/workflow/stage-move-actions.ts); this is who may make them.
--
-- Its own permission rather than `decisions.override`, because a move also
-- speaks for the family (an acceptance recorded on their behalf) and for
-- finance (a payment request closed, or left open for them to confirm), and a
-- school may want those apart. Granted to the admissions manager, who already
-- approves offers and overrides decisions; the super administrator holds
-- `admin`, which satisfies every check.
insert into public.permissions (code, label, sort_order)
values ('applications.move_stage', 'Move an applicant to a later stage, skipping steps, with a reason', 27)
on conflict (code) do update set label = excluded.label, sort_order = excluded.sort_order;

insert into public.role_permissions (role_id, permission_code)
select r.id, 'applications.move_stage'
  from public.roles r
 where r.code = 'admissions_manager'
on conflict do nothing;

-- The message for a child moved straight to registration. Every other way
-- into registration arrives with a payment email (`payment_received`,
-- `fees_waived`, `fees_none`), and each of them talks about money: received,
-- waived, or none due. A family moved on by hand may have paid somewhere this
-- system did not see, or may pay with the first invoice, and the school asked
-- that they hear only what is due from them now. So this one says nothing
-- about money at all.
insert into public.email_templates (key, version, name, description, subject, body_html, body_text, allowed_variables, is_active, audience)
select 'registration_open', 1, 'Registration is due',
  'Sent when an admissions officer moves a child straight to registration (Move to stage). Says only that registration is the next step; nothing about payment.',
  'The next step for {{student_first_name}}: registration',
  '<p>Dear {{parent_first_name}},</p><p>{{student_first_name}}''s place at {{campus}} in {{grade}} is ready for the last step: registration.</p><p>Registration is the information the school needs before {{student_first_name}} starts. We already have the details you gave us, so it is quick. You can stop and come back to it at any time.</p><p><a href="{{registration_link}}" class="button">Complete registration</a></p><p>Reference: {{application_reference}}</p><p>Warm regards,<br>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\n{{student_first_name}}''s place at {{campus}} in {{grade}} is ready for the last step: registration.\n\nRegistration is the information the school needs before {{student_first_name}} starts. We already have the details you gave us, so it is quick. You can stop and come back to it at any time.\n\nComplete registration here:\n{{registration_link}}\n\nReference: {{application_reference}}\n\nWarm regards,\nHibiscus International Schools Admissions',
  array['parent_first_name','student_first_name','campus','grade','application_reference','registration_link','next_step_link'],
  true, 'parent'
where not exists (select 1 from public.email_templates where key = 'registration_open');

-- Its WhatsApp companion, inactive: a template is sent only once the provider
-- has approved it and its id is pasted in under Set up → WhatsApp templates.
-- Until then the email goes alone, which is what happens for every new moment.
insert into public.message_templates (key, name, language, body_preview, parameters, button_link, link_purpose, is_active, audience)
values (
  'registration_open',
  'Registration is due',
  'en',
  E'Hi {{1}}, the next step for {{2}} at {{3}} is the registration form. Tap below to complete it.',
  array['parent_first_name', 'student_first_name', 'campus'],
  true,
  'registration',
  false,
  'applicant'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The Ed-admin export belongs to the chief financial officer
-- ---------------------------------------------------------------------------

-- The student export used to need `data.export`, which the admissions manager
-- holds for the analytics download. The school wants the file that goes to
-- Ed-admin — every enrolled child, with their family — in one pair of hands:
-- the chief financial officer's. So it gets its own permission, and a role to
-- carry it.
insert into public.permissions (code, label, sort_order)
values ('enrolment.export', 'Export enrolled children to Ed-admin', 162)
on conflict (code) do update set label = excluded.label, sort_order = excluded.sort_order;

-- Finance's permissions, plus the export. Not campus-scoped: the export is
-- the whole group's. Only somebody who holds every one of these may hand the
-- role out (`can_grant_role`), which in practice is the super administrator.
insert into public.roles (code, name, description, is_system, campus_scoped)
values ('chief_financial_officer', 'Chief financial officer', 'Payments and fee schedules, and the only role that exports enrolled children to Ed-admin.', true, false)
on conflict (code) do update set name = excluded.name, description = excluded.description, campus_scoped = excluded.campus_scoped;

with grants(permission_code) as (
  values ('applications.read'), ('offers.read'), ('finance.read'), ('finance.write'), ('enrolment.export')
)
insert into public.role_permissions (role_id, permission_code)
select r.id, g.permission_code
  from grants g
  join public.roles r on r.code = 'chief_financial_officer'
on conflict do nothing;

-- The batches: what was exported, when and by whom. Readable by whoever may
-- export, as before; "whoever may export" is now the export's own permission.
drop policy if exists student_exports_select on public.student_exports;
create policy student_exports_select on public.student_exports
  for select using (
    (select public.has_permission('enrolment.export'))
    and (campus_id is null or (select public.can_access_campus(campus_id)))
  );

-- ---------------------------------------------------------------------------
-- Prove it
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id
     where r.code = 'admissions_manager' and rp.permission_code = 'applications.move_stage'
  ) then
    raise exception 'the admissions manager cannot move a child to another stage';
  end if;

  if (select count(*) from public.role_permissions rp join public.roles r on r.id = rp.role_id
       where r.code = 'chief_financial_officer' and rp.permission_code in ('applications.read', 'offers.read', 'finance.read', 'finance.write', 'enrolment.export')) <> 5 then
    raise exception 'the chief financial officer role is missing a permission';
  end if;

  -- Only the CFO role (and the super administrator, through `admin`) may
  -- export. A role granted it by hand later is the school's choice; one
  -- granted it here would be a mistake.
  if exists (
    select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id
     where rp.permission_code = 'enrolment.export' and r.code <> 'chief_financial_officer'
  ) then
    raise exception 'a role other than the chief financial officer holds the Ed-admin export';
  end if;

  if not exists (select 1 from public.email_templates where key = 'registration_open' and is_active) then
    raise exception 'the registration_open email is missing';
  end if;
end $$;
