-- Staff invitations that do not expire.
--
-- Supabase's own invite email carries a token that lasts a day and is spent
-- the first time anything opens the URL — including the link scanners that
-- school mail systems run before a human ever clicks. The result was an
-- invitation that read "expired" on the first click. This is our own link
-- instead: minted here, emailed through our own templates, and valid until
-- it is used or replaced.
--
-- Only the SHA-256 hash is stored, exactly like the parents' magic links, so
-- possession of the database is not possession of anybody's invitation.

create table if not exists public.staff_invites (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_profiles(id) on delete cascade,
  token_hash text not null unique,
  -- Null means it never expires, which is the point of this table. A date
  -- can still be set for a one-off invitation that should lapse.
  expires_at timestamptz,
  -- Set when the password is chosen, not when the page is opened: a scanner
  -- that fetches the URL therefore cannot spend the invitation.
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists staff_invites_staff_idx on public.staff_invites(staff_id, created_at desc);
-- The one live invitation per person, which is what "resend" replaces.
create index if not exists staff_invites_live_idx
  on public.staff_invites(staff_id)
  where accepted_at is null and revoked_at is null;

comment on table public.staff_invites is
  'Invitation links for the staff console. Hash only; the raw token exists in the email and nowhere else. No expiry by default.';

alter table public.staff_invites enable row level security;

-- No policies: the service role mints, reads and spends these. A signed-in
-- member of staff has no reason to read another person''s invitation, and
-- the person accepting one is not signed in yet.
revoke all on table public.staff_invites from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The email
-- ---------------------------------------------------------------------------

insert into public.email_templates (key, name, description, subject, body_text, body_html, allowed_variables, audience)
values (
  'staff_invite',
  'Invitation to the admissions console (staff)',
  'Sent when a member of staff is invited, and again by Resend invitation. The link does not expire; it stops working once the password is set or a newer invitation is sent.',
  'Your Hibiscus admissions account',
  E'Hello {{staff_first_name}},\n\n{{inviter_name}} has set up an account for you on the Hibiscus admissions console.\n\nChoose your password here:\n{{invite_link}}\n\nThe link does not expire, but it works once. If you have already set a password, sign in at {{console_link}} instead.\n\nHibiscus Admissions',
  '<p>Hello {{staff_first_name}},</p><p>{{inviter_name}} has set up an account for you on the Hibiscus admissions console.</p><p><a href="{{invite_link}}" class="button">Choose your password</a></p><p>The link does not expire, but it works once. If you have already set a password, <a href="{{console_link}}">sign in</a> instead.</p><p>Hibiscus Admissions</p>',
  array['staff_first_name','inviter_name','invite_link','console_link'],
  'staff'
)
on conflict (key, version) do nothing;
