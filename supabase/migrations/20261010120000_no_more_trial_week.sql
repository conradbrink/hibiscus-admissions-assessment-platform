-- No more free trial week.
--
-- On 10 October 2026 the school decided the pre-schools will no longer offer
-- a free one-week trial. A pre-school family books a visit like everybody
-- else (20261007070000) and the decision is taken on the review queue as
-- before. The code that offered the week, recorded what came of it and
-- showed it on the queue and the applicant page is gone; this migration
-- deals with what that code left in the database.
--
-- Nothing is deleted. `trial_weeks` and its read policy stay: a week that
-- was offered, attended or missed is part of how a child was decided, and
-- the applicant timeline still reads back its `trial_week.*` events. Only
-- what is still *live* is closed:
--
--   1. a week still invited or confirmed is cancelled, with a note saying
--      why, so the row explains itself to whoever reads it later;
--   2. an application whose next action still reads "free trial week" goes
--      back to waiting for the school, which is where the old code put it
--      when a week ended. `next_action` is not `status`, so this is not the
--      engine's write to make, and no earlier migration that corrected data
--      wrote a timeline event for it either — the cancelled `trial_weeks`
--      row is the record;
--   3. the task asking somebody to see the week through is cancelled;
--   4. an invitation or event follow-up still queued is skipped rather than
--      sent, the email and its WhatsApp companion alike, with the reason in
--      `last_error` where the jobs page shows it;
--   5. the four templates that offered the week are switched off, never
--      deleted: `email_messages`, `messages` and campaigns name them, and an
--      approved WhatsApp template costs nothing to keep;
--   6. a campaign that names one of the event follow-ups and has not been
--      sent is cancelled. `campaigns_guard_transition` allows a cancel from
--      every status but `sent`; it is skipped for `sent` and `cancelled`
--      here so the guard is never asked. `sending` is included on purpose:
--      the drain reads the status before every batch and stops on
--      `cancelled`, so the families not yet reached are not offered a week
--      that no longer exists. The guard writes the audit row as System.
--
-- Every step is guarded by the state it changes, so running this twice is a
-- no-op.

-- 1. Live weeks.
update public.trial_weeks
   set status = 'cancelled',
       outcome_note = coalesce(outcome_note, 'Trial week removed by the school'),
       updated_at = now()
 where status in ('invited', 'confirmed');

-- 2. The next action. `attend_trial_week` is no longer one the code knows.
update public.applications
   set next_action = 'await_school_contact',
       next_action_due_at = null
 where next_action = 'attend_trial_week';

-- 3. The "see the week through" task.
update public.tasks
   set status = 'cancelled',
       resolved_at = now(),
       resolution_note = 'Cancelled: the school removed the free trial week'
 where type = 'trial_week'
   and status = 'open';

-- 4. Anything still waiting to tell a family about a week. `send_whatsapp`
--    is the companion the email handler queues under the same template key;
--    a family moment sends its companion inline from `send_email`, so the
--    one job type covers it. `running` is left to finish: it is mid-send.
update public.jobs
   set status = 'skipped',
       last_error = 'The school removed the free trial week',
       completed_at = now()
 where type in ('send_email', 'send_whatsapp')
   and status in ('pending', 'failed')
   and payload->>'template_key' in (
     'trial_week_invitation',
     'event_thank_you',
     'event_free_trial_reminder',
     'event_free_trial_last_call'
   );

-- 5. The templates. Deactivating cannot trip `message_templates_check`
--    (it only asks an *active* row for a Zavu id) or
--    `email_templates_one_active_idx` (it only counts active rows).
update public.email_templates
   set is_active = false,
       updated_at = now()
 where key in ('trial_week_invitation', 'event_thank_you', 'event_free_trial_reminder', 'event_free_trial_last_call')
   and is_active;

update public.message_templates
   set is_active = false,
       updated_at = now()
 where key in ('trial_week_invitation', 'event_thank_you', 'event_free_trial_reminder', 'event_free_trial_last_call')
   and is_active;

-- 6. Campaigns built on the event follow-ups. Only the status changes, so
--    neither `campaign_locked` (the message columns) nor
--    `campaigns_sms_locked` (the SMS body) can fire.
update public.campaigns
   set status = 'cancelled'
 where message_template_key in ('event_thank_you', 'event_free_trial_reminder', 'event_free_trial_last_call')
   and status in ('draft', 'pending_approval', 'approved', 'scheduled', 'paused', 'sending');

-- Nothing a parent can still receive should offer a trial or a free week.
do $$
declare
  stragglers text;
begin
  select string_agg(k, ', ' order by k) into stragglers
    from (
      select 'email_templates.' || key as k
        from public.email_templates
       where is_active
         and (
              subject ilike any (array['%trial%', '%free week%', '%one-week%'])
           or body_html ilike any (array['%trial%', '%free week%', '%one-week%'])
           or body_text ilike any (array['%trial%', '%free week%', '%one-week%'])
         )
      union
      select 'message_templates.' || key
        from public.message_templates
       where is_active
         and body_preview ilike any (array['%trial%', '%free week%', '%one-week%'])
    ) s;
  if stragglers is not null then
    raise exception 'an active template still offers a trial or a free week: %', stragglers;
  end if;
end $$;
