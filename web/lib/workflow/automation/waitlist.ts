import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { placesRemaining } from "@/lib/rules/capacity";
import { getSettings } from "@/lib/settings";
import type { ApplicationRow } from "@/lib/supabase/types";
import { groupByPlace, waitlistOrder } from "@/lib/workflow/automation/rules";
import { applyDecision } from "@/lib/workflow/decision-actions";
import { commit, SYSTEM_ACTOR } from "@/lib/workflow/engine";

/**
 * When a place opens for a grade at a campus, the longest-waiting
 * waitlisted applicant is offered it: by default as a task for a person;
 * with `waitlist_auto_promote`, as a decision the rules engine records,
 * after which the usual offer drafting and human approval follow.
 *
 * Places open when an offer is declined or expires, an application is
 * withdrawn, or a capacity is raised; nothing here watches for those —
 * the drain calls this every few minutes and it looks at what is true.
 */

export async function promoteWaitlist(admin: AdminClient): Promise<{ promoted: number; tasks: number }> {
  const settings = await getSettings(admin);
  const { data: waiting, error } = await admin
    .from("applications")
    .select("id, status, child_first_name, campus_id, grade_id, intake_id, status_changed_at")
    .eq("status", "waitlisted")
    .limit(500);
  if (error) throw new Error(error.message);
  if (!waiting?.length) return { promoted: 0, tasks: 0 };

  const { data: intakes } = await admin.from("intakes").select("id, academic_year_id").in("id", [...new Set(waiting.map((w) => w.intake_id))]);
  const yearOf = new Map((intakes ?? []).map((i) => [i.id, i.academic_year_id]));
  const { data: openTasks } = await admin.from("tasks").select("application_id").eq("status", "open").eq("type", "waitlist_place_available");
  const hasTask = new Set((openTasks ?? []).map((t) => t.application_id));

  let promoted = 0;
  let tasks = 0;
  for (const group of groupByPlace(waiting, (id) => yearOf.get(id) ?? null).values()) {
    const first = group[0];
    const remaining = await placesRemaining(admin, { campusId: first.campus_id, gradeId: first.grade_id, intakeId: first.intake_id });
    // No capacity set means nobody should be waitlisted for lack of a place; leave those to a person.
    if (remaining === null || remaining <= 0) continue;
    for (const app of waitlistOrder(group).slice(0, remaining)) {
      if (settings.waitlistAutoPromote) {
        await onWaitlistPromoted(admin, app);
        promoted += 1;
      } else if (!hasTask.has(app.id)) {
        await commit(admin, {
          applicationId: app.id,
          expectedStatus: "waitlisted",
          newStatus: null,
          nextAction: null,
          event: { type: "waitlist.place_available", summary: "A place is available for this waitlisted applicant", payload: { places_remaining: remaining } },
          tasks: [
            {
              type: "waitlist_place_available",
              title: `${app.child_first_name}: a place is available`,
              details: `${remaining} place(s) open for this grade at this campus. Record a decision of Approved on the applicant page to offer it, or leave them waitlisted.`,
              priority: "high",
            },
          ],
          actor: SYSTEM_ACTOR,
        });
        hasTask.add(app.id);
        tasks += 1;
      }
    }
  }
  return { promoted, tasks };
}

/** The rules engine records the approval; the offer is drafted and approved as for any other. */
export async function onWaitlistPromoted(admin: AdminClient, app: Pick<ApplicationRow, "id" | "status" | "child_first_name">): Promise<void> {
  const { data: attempt } = await admin.from("attempts").select("id").eq("application_id", app.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  await applyDecision(admin, app, {
    outcome: "approved",
    computedOutcome: "approved",
    attemptId: attempt?.id ?? null,
    ruleset: null,
    inputs: { reason: "waitlist_promotion" },
    reason: "A place became available; promoted from the waitlist",
    decidedBy: "rules",
    actor: SYSTEM_ACTOR,
  });
}
