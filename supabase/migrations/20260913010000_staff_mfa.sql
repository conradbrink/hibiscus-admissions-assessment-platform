-- A second factor for staff sign-in.
--
-- Everything the console protects has rested on a password: fourteen
-- families' registrations and their documents, the fee schedule, the offer
-- letters, the register. A phished password is all of it, and no policy in
-- this database can tell a stolen password from its owner.
--
-- The factors themselves live in `auth.mfa_factors`, which is Supabase's and
-- not ours to model. What belongs here is the school's decision about whom to
-- ask, and the audit trail of the moments that matter.
--
-- It ships OFF, and that is deliberate rather than timid. Thirty people use
-- this console every day; switching a second factor on for all of them at
-- once, at a distance, with no way to ring anybody, is how a school loses a
-- morning of admissions. The intended order is: staff enrol voluntarily from
-- Set up → My security, the school watches the number climb, and then this is
-- switched on to catch the rest.
--
-- One thing the switch deliberately cannot do: it cannot let somebody who has
-- already enrolled skip their own factor. Turning it off stops *asking* people
-- who have not enrolled; it never quietly downgrades somebody who has. That
-- rule lives in web/lib/staff/mfa.ts and is tested there.

insert into public.settings (key, value, description)
values (
  'staff_mfa_required',
  'false'::jsonb,
  'Require every member of staff to set up an authenticator app before the console opens. Off: enrolling is each person''s choice, and anybody who has enrolled is always asked for their code. On: a person with no authenticator is sent to Set up → My security and cannot use the console until they have one. Switch this on only once most people have enrolled, and make sure a second super administrator can reset a lost device.'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- The audit trail
-- ---------------------------------------------------------------------------

-- Enrolling, removing, and an administrator resetting somebody else's device
-- are all security events, and the third is the one that matters most: it is
-- the supported way to take a second factor off an account, which makes it
-- the route anybody attacking the console would want. It is recorded with who
-- did it and to whom, in the same append-only log as everything else — the log
-- that, as of the previous migration, not even a signed-in administrator can
-- truncate.
--
-- No schema change is needed for that: `audit_log` already takes an action and
-- an actor. This comment is here so the next person looks for these actions by
-- name rather than wondering whether they exist.
--
--   staff.mfa_enrolled   somebody set up their own authenticator
--   staff.mfa_removed    somebody removed their own
--   staff.mfa_reset      an administrator cleared somebody else's factors
comment on table public.audit_log is
  'Append-only record of what staff did. Readable with audit.read, writable only by the service role: there is no insert, update or delete policy, so no signed-in person can add, alter or remove a line, and TRUNCATE was revoked in 20260913000000. Security actions to look for by name include staff.mfa_enrolled, staff.mfa_removed and staff.mfa_reset.';
