-- The play-date templates are switched off.
--
-- 20261007070000 left `playdate_confirmed` and `playdate_moved` active in both
-- tables: nothing routes to them, and keeping them meant the warmer wording
-- could come back without a fresh Meta submission. But "active" is also what
-- the WhatsApp picker on an applicant's page lists (applicant-phase2.tsx), so
-- a member of staff could still send a pre-school parent "The play date at our
-- campus is on …" by hand. The school has settled on visits, so they go off.
--
-- Switched off, not deleted: the rows, their versions and the provider's
-- approval all stay, and setting `is_active` back is the whole of undoing it.
-- The template coverage check looks at rows, not at whether they are active,
-- so it is unaffected.

update public.email_templates
   set is_active = false,
       updated_at = now()
 where key in ('playdate_confirmed', 'playdate_moved')
   and is_active;

update public.message_templates
   set is_active = false,
       updated_at = now()
 where key in ('playdate_confirmed', 'playdate_moved')
   and is_active;
