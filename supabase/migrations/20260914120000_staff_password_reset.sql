-- ---------------------------------------------------------------------------
-- Password resets on the invitation's rails
-- ---------------------------------------------------------------------------

-- "Forgot password" used Supabase Auth's own mailer. Across every staff
-- account this project has ever had, `auth.users.recovery_sent_at` is null:
-- not one reset email has ever gone out. The request is answered 200 in a
-- millisecond and nothing is sent — the built-in service does not deliver to
-- addresses outside the Supabase organisation, and nothing on our side could
-- see that. Invitations, which go through our own templates and Resend, have
-- always arrived.
--
-- So a reset is now the same thing as an invitation: a link we mint, hashed
-- in this table, emailed by us, spent when the password is set. One column
-- says which of the two it is, because the page it opens reads differently
-- ("Welcome" is wrong for somebody who has worked here a year) and because a
-- reset lapses after an hour where an invitation never does.
alter table public.staff_invites
  add column if not exists purpose text not null default 'invite';

alter table public.staff_invites drop constraint if exists staff_invites_purpose_check;
alter table public.staff_invites
  add constraint staff_invites_purpose_check check (purpose in ('invite', 'reset'));

comment on column public.staff_invites.purpose is
  'invite: sets a first password and never lapses. reset: asked for from the sign-in page, lapses after an hour. Either replaces every earlier live link for the person.';

-- ---------------------------------------------------------------------------
-- The email
-- ---------------------------------------------------------------------------

insert into public.email_templates (key, name, description, subject, body_text, body_html, allowed_variables, audience)
values (
  'staff_password_reset',
  'Password reset link (staff)',
  'Sent when somebody asks for a reset from the sign-in page. The link works once and lapses after an hour; asking again replaces it.',
  'Reset your Hibiscus admissions password',
  E'Hello {{staff_first_name}},\n\nSomebody asked to reset the password for your account on the Hibiscus admissions console. If that was you, choose a new password here:\n{{reset_link}}\n\nThe link works once and for one hour. If you did not ask for this, ignore this email — your password has not changed.\n\nHibiscus Admissions',
  '<p>Hello {{staff_first_name}},</p><p>Somebody asked to reset the password for your account on the Hibiscus admissions console. If that was you, choose a new password here:</p><p><a href="{{reset_link}}" class="button">Choose a new password</a></p><p>The link works once and for one hour. If you did not ask for this, ignore this email — your password has not changed.</p><p>Hibiscus Admissions</p>',
  array['staff_first_name','reset_link','console_link'],
  'staff'
)
on conflict (key, version) do nothing;
