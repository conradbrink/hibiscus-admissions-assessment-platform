-- ---------------------------------------------------------------------------
-- Decisions that actually took effect
-- ---------------------------------------------------------------------------

-- `admission_decisions` is append-only on purpose, and it should stay that way:
-- a decision about a child is not something anybody edits afterwards.
--
-- But until the previous migration's fix, the row was written *before* the
-- transition was checked, so a decision the state machine refused left a row
-- behind with no status change, no timeline entry and no audit. One applicant
-- collected three; the profile page showed them as three green approvals of a
-- child who had not been approved, and staff reasonably read them as done.
--
-- Those rows cannot be deleted and should not be: they are a true record that
-- somebody pressed the button. What they are not is decisions. This view is
-- the difference, and it is what every screen reads.
--
-- The test is the timeline. `commit` writes `decision.made` (or
-- `decision.referred`) in the same transaction as the status change, so a
-- decision that took effect has one within a moment of itself — every real one
-- on record lands inside 1.1 seconds, and every orphan has none at all. Ten
-- seconds is wide enough to survive a slow transaction and far narrower than
-- the gap between two decisions a person makes by hand.
create or replace view public.v_effective_decisions
with (security_invoker = true)
as
select d.*
from public.admission_decisions d
where exists (
  select 1
  from public.application_events e
  where e.application_id = d.application_id
    and e.type in ('decision.made', 'decision.referred')
    and e.occurred_at between d.decided_at - interval '10 seconds'
                          and d.decided_at + interval '10 seconds'
);

comment on view public.v_effective_decisions is
  'Rows of admission_decisions that actually moved the application, matched to their decision.made/decision.referred event. Read this, not the table, anywhere a decision is shown or summarised; the table keeps every attempt including the ones the state machine refused.';

grant select on public.v_effective_decisions to authenticated;
