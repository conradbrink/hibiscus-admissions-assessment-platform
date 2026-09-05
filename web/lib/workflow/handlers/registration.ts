import "server-only";
import { loadApplicationGraph } from "@/lib/applications";
import type { AdminClient } from "@/lib/supabase/admin";
import type { JobRow } from "@/lib/supabase/types";
import { SYSTEM_ACTOR, WorkflowError } from "@/lib/workflow/engine";
import { onEnrolmentConfirmed } from "@/lib/workflow/enrolment-actions";
import type { HandlerResult } from "@/lib/workflow/handlers";

/** The auto_enrol switch: enrol on submission without a person. Refusals (a document not yet accepted is not one on this path) skip, never strand. */
export async function autoEnrolHandler(admin: AdminClient, job: JobRow): Promise<HandlerResult> {
  if (!job.application_id) return { outcome: "failed", error: "auto_enrol job missing application", retryable: false };
  const graph = await loadApplicationGraph(admin, job.application_id);
  if (!graph) return { outcome: "skipped", reason: "application missing" };
  if (graph.application.status !== "registration_complete") return { outcome: "skipped", reason: `application is ${graph.application.status}` };
  try {
    await onEnrolmentConfirmed(admin, graph, SYSTEM_ACTOR);
    return { outcome: "done" };
  } catch (e) {
    if (e instanceof WorkflowError && e.code === "status_conflict") return { outcome: "skipped", reason: e.message };
    throw e;
  }
}
