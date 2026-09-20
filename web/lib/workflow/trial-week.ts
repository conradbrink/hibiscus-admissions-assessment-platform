import "server-only";
import { formatDateLong } from "@/lib/format-date";
import type { AdminClient } from "@/lib/supabase/admin";
import type { ApplicationRow, TrialWeekRow, TrialWeekStatus } from "@/lib/supabase/types";
import { commit, WorkflowError, type Actor } from "@/lib/workflow/engine";
import { canBeDecided } from "@/lib/workflow/states";
import { formatTrialWeek, trialWeekDates } from "@/lib/workflow/trial-week-dates";

/**
 * The pre-schools' free trial week.
 *
 * Offered from the review queue for a child who sits no assessment, while
 * the application waits for a decision. The application does not move: its
 * next action says "free trial week" while the week is live and goes back
 * to waiting afterwards, and the decision is recorded on the queue as
 * before, now with the week behind it. The parent is told by the same
 * email-and-companion machinery as every other moment, the school gets a
 * task to see the week through, and the family is tagged in the CRM so a
 * segment can find everyone who has had one.
 */

export const TRIAL_WEEK_TAG = "free-trial-week";
export const TRIAL_WEEK_TASK = "trial_week";

/** The one live offer on an application, or null. */
export async function liveTrialWeek(admin: AdminClient, applicationId: string): Promise<TrialWeekRow | null> {
  const { data, error } = await admin.from("trial_weeks").select("*").eq("application_id", applicationId).in("status", ["invited", "confirmed"]).maybeSingle();
  if (error) throw new WorkflowError(error.message, "database");
  return data;
}

export async function offerTrialWeek(
  admin: AdminClient,
  app: ApplicationRow,
  opts: { startsOn: string; endsOn?: string | null; note?: string | null; actor: Actor; today?: Date }
): Promise<TrialWeekRow> {
  if (app.requires_assessment) {
    throw new WorkflowError("A free trial week is for the pre-schools. This child sits an assessment.", "illegal_transition");
  }
  if (!canBeDecided(app.status)) {
    throw new WorkflowError("A trial week is offered while the application waits for a decision.", "illegal_transition");
  }
  const checked = trialWeekDates(opts.startsOn, opts.endsOn, opts.today ?? new Date());
  if (!checked.ok) throw new WorkflowError(checked.error, "illegal_transition");
  if (await liveTrialWeek(admin, app.id)) {
    throw new WorkflowError("This family already has a trial week on offer. Record what came of it first.", "illegal_transition");
  }
  const note = opts.note?.trim() || null;
  const { data: trial, error } = await admin
    .from("trial_weeks")
    .insert({ application_id: app.id, campus_id: app.campus_id, starts_on: checked.dates.startsOn, ends_on: checked.dates.endsOn, note, invited_by: opts.actor.id ?? null })
    .select("*")
    .single();
  if (error || !trial) throw new WorkflowError(error?.message ?? "trial week insert failed", "database");

  const range = formatTrialWeek(checked.dates);
  const dayBefore = new Date(`${checked.dates.startsOn}T06:00:00Z`);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  await commit(admin, {
    applicationId: app.id,
    expectedStatus: app.status,
    newStatus: null,
    nextAction: "attend_trial_week",
    nextActionDueAt: new Date(`${checked.dates.endsOn}T14:00:00Z`),
    event: {
      type: "trial_week.offered",
      summary: `Free trial week offered: ${range}${note ? ` — ${note}` : ""}`,
      payload: { trial_week_id: trial.id, starts_on: trial.starts_on, ends_on: trial.ends_on },
    },
    tasks: [
      {
        type: TRIAL_WEEK_TASK,
        title: `See ${app.child_first_name}'s free trial week through (${range})`,
        details: "The family has been emailed the dates. On the review queue, mark the week confirmed once they reply, then attended or not once it is over, and record the decision.",
        priority: "normal",
        dueAt: dayBefore,
      },
    ],
    jobs: [
      {
        type: "send_email",
        payload: {
          template_key: "trial_week_invitation",
          variables: {
            trial_week_start: formatDateLong(checked.dates.startsOn),
            trial_week_end: formatDateLong(checked.dates.endsOn),
            trial_week_note: note,
          },
        },
        idempotencyKey: `email:${app.id}:trial_week_invitation:${trial.id}`,
        // Decided or withdrawn before the drain got to it: the invitation
        // would be wrong, so it is not sent.
        precondition: { application_status: [app.status] },
      },
    ],
    audit: { action: "trial_week.offered", after: { trial_week_id: trial.id, starts_on: trial.starts_on, ends_on: trial.ends_on, note } },
    actor: opts.actor,
  });
  await tagFamily(admin, app);
  return trial;
}

/** The family, in the CRM, carries the tag from the first offer on. Best-effort: the offer stands without it. */
async function tagFamily(admin: AdminClient, app: ApplicationRow): Promise<void> {
  const { data: contact } = await admin.from("contacts").select("family_id").eq("id", app.contact_id).maybeSingle();
  if (!contact?.family_id) return;
  const { data: family } = await admin.from("families").select("tags").eq("id", contact.family_id).maybeSingle();
  if (!family || family.tags.includes(TRIAL_WEEK_TAG)) return;
  const { error } = await admin.from("families").update({ tags: [...family.tags, TRIAL_WEEK_TAG] }).eq("id", contact.family_id);
  if (error) console.error("[trial week] family tag failed", { familyId: contact.family_id, error: error.message });
}

const MOVES: Record<TrialWeekStatus, readonly TrialWeekStatus[]> = {
  invited: ["confirmed", "attended", "no_show", "cancelled"],
  confirmed: ["attended", "no_show", "cancelled"],
  attended: [],
  no_show: [],
  cancelled: [],
};

const SUMMARY: Record<Exclude<TrialWeekStatus, "invited">, string> = {
  confirmed: "Family confirmed the free trial week",
  attended: "Free trial week attended",
  no_show: "Did not come to the free trial week",
  cancelled: "Free trial week cancelled",
};

/** What came of the week: confirmed by the family, attended, missed, or called off. */
export async function recordTrialWeekOutcome(
  admin: AdminClient,
  app: ApplicationRow,
  trialId: string,
  status: Exclude<TrialWeekStatus, "invited">,
  note: string | null,
  actor: Actor
): Promise<TrialWeekRow> {
  const { data: trial, error } = await admin.from("trial_weeks").select("*").eq("id", trialId).eq("application_id", app.id).maybeSingle();
  if (error) throw new WorkflowError(error.message, "database");
  if (!trial) throw new WorkflowError("That trial week is not on this application.", "illegal_transition");
  if (!MOVES[trial.status].includes(status)) {
    throw new WorkflowError(`The trial week is already ${trial.status.replace("_", " ")}.`, "illegal_transition");
  }
  const outcomeNote = note?.trim() || null;
  const { data: updated, error: uErr } = await admin
    .from("trial_weeks")
    .update({ status, outcome_note: status === "confirmed" ? trial.outcome_note : (outcomeNote ?? trial.outcome_note) })
    .eq("id", trial.id)
    .select("*")
    .single();
  if (uErr || !updated) throw new WorkflowError(uErr?.message ?? "trial week update failed", "database");

  const range = formatTrialWeek({ startsOn: trial.starts_on, endsOn: trial.ends_on });
  const live = status === "confirmed";
  await commit(admin, {
    applicationId: app.id,
    expectedStatus: app.status,
    newStatus: null,
    // Confirmed keeps the week as the next step; anything final hands the
    // family back to the decision they were waiting on.
    nextAction: live ? "attend_trial_week" : canBeDecided(app.status) ? "await_school_contact" : null,
    nextActionDueAt: live ? new Date(`${trial.ends_on}T14:00:00Z`) : null,
    event: {
      type: `trial_week.${status}`,
      summary: `${SUMMARY[status]}: ${range}${outcomeNote ? ` — ${outcomeNote}` : ""}`,
      payload: { trial_week_id: trial.id, starts_on: trial.starts_on, ends_on: trial.ends_on, note: outcomeNote },
    },
    resolveTaskTypes: live ? undefined : [TRIAL_WEEK_TASK],
    audit: { action: `trial_week.${status}`, before: { status: trial.status }, after: { status, note: outcomeNote } },
    actor,
  });
  return updated;
}
