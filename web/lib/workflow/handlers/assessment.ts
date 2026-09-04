import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { JobRow } from "@/lib/supabase/types";
import { getSettings } from "@/lib/settings";
import { onAssessmentAbandoned, onAssessmentSubmitted, runMarking } from "@/lib/workflow/assessment-actions";
import { SYSTEM_ACTOR } from "@/lib/workflow/engine";
import type { HandlerResult } from "@/lib/workflow/handlers";

function attemptIdOf(job: JobRow): string | null {
  const p = job.payload as { attempt_id?: string };
  return typeof p.attempt_id === "string" ? p.attempt_id : null;
}

/** Marks a submitted attempt. Idempotent; a re-run re-marks objective items only. */
export async function markAttemptHandler(admin: AdminClient, job: JobRow): Promise<HandlerResult> {
  const attemptId = attemptIdOf(job);
  if (!attemptId) return { outcome: "failed", error: "mark_attempt job missing attempt_id", retryable: false };
  await runMarking(admin, attemptId, SYSTEM_ACTOR);
  return { outcome: "done" };
}

/**
 * The sweep after a launch. Three cases: the child is still sitting past
 * the clock plus grace, so the paper is handed in for them; the code was
 * never used, so the attempt is abandoned and the booking freed; or
 * somebody already dealt with it, and there is nothing to do.
 */
export async function expireAttemptHandler(admin: AdminClient, job: JobRow): Promise<HandlerResult> {
  const attemptId = attemptIdOf(job);
  if (!attemptId) return { outcome: "failed", error: "expire_attempt job missing attempt_id", retryable: false };
  const { data: attempt, error } = await admin.from("attempts").select("*").eq("id", attemptId).maybeSingle();
  if (error) return { outcome: "failed", error: error.message, retryable: true };
  if (!attempt) return { outcome: "skipped", reason: "attempt missing" };
  const { data: app } = await admin
    .from("applications")
    .select("id, status, child_first_name")
    .eq("id", attempt.application_id)
    .single();
  if (!app) return { outcome: "skipped", reason: "application missing" };
  const settings = await getSettings(admin);

  if (attempt.status === "in_progress") {
    const deadline = new Date(attempt.expires_at ?? 0).getTime() + settings.attemptGraceSeconds * 1000;
    if (Date.now() < deadline) {
      // Started late (a slow code entry); try again after the real deadline.
      return { outcome: "failed", error: "attempt still within its time; retrying later", retryable: true };
    }
    await onAssessmentSubmitted(admin, app, attempt, { auto: true }, SYSTEM_ACTOR);
    return { outcome: "done" };
  }
  if (attempt.status === "ready") {
    await onAssessmentAbandoned(admin, app, attempt, "The launch code was never used", SYSTEM_ACTOR);
    return { outcome: "done" };
  }
  return { outcome: "skipped", reason: `attempt is ${attempt.status}` };
}
