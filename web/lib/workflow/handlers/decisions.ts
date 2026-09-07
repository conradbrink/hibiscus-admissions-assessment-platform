import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { JobRow } from "@/lib/supabase/types";
import { autoMarkResponse } from "@/lib/ai/auto-mark";
import { suggestWritingBand } from "@/lib/ai/writing-band";
import { runMarking } from "@/lib/workflow/assessment-actions";
import { generateLearningProfile } from "@/lib/profile/generate";
import { evaluateAndDecide, onOutcomeSent } from "@/lib/workflow/decision-actions";
import { SYSTEM_ACTOR } from "@/lib/workflow/engine";
import type { HandlerResult } from "@/lib/workflow/handlers";

function attemptIdOf(job: JobRow): string | null {
  const p = job.payload as { attempt_id?: string };
  return typeof p.attempt_id === "string" ? p.attempt_id : null;
}

export async function evaluateAdmissionHandler(admin: AdminClient, job: JobRow): Promise<HandlerResult> {
  const attemptId = attemptIdOf(job);
  if (!attemptId) return { outcome: "failed", error: "evaluate_admission job missing attempt_id", retryable: false };
  await evaluateAndDecide(admin, attemptId);
  return { outcome: "done" };
}

export async function generateProfileHandler(admin: AdminClient, job: JobRow): Promise<HandlerResult> {
  const attemptId = attemptIdOf(job);
  if (!attemptId) return { outcome: "failed", error: "generate_learning_profile job missing attempt_id", retryable: false };
  await generateLearningProfile(admin, attemptId);
  return { outcome: "done" };
}

export async function suggestWritingBandHandler(admin: AdminClient, job: JobRow): Promise<HandlerResult> {
  const p = job.payload as { attempt_id?: string; form_question_id?: string };
  if (!p.attempt_id || !p.form_question_id) {
    return { outcome: "failed", error: "suggest_writing_band job missing ids", retryable: false };
  }
  const result = await suggestWritingBand(admin, p.attempt_id, p.form_question_id);
  return result === "suggested" ? { outcome: "done" } : { outcome: "skipped", reason: "nothing to suggest" };
}

/**
 * Marks one written answer by the model, then runs marking again so the
 * attempt completes when every answer is in. An answer the model cannot
 * mark hands the whole attempt to a person, as before the switch existed.
 */
export async function aiMarkResponseHandler(admin: AdminClient, job: JobRow): Promise<HandlerResult> {
  const p = job.payload as { attempt_id?: string; form_question_id?: string };
  if (!p.attempt_id || !p.form_question_id) {
    return { outcome: "failed", error: "ai_mark_response job missing ids", retryable: false };
  }
  const result = await autoMarkResponse(admin, p.attempt_id, p.form_question_id);
  if (result === "marked") {
    await runMarking(admin, p.attempt_id, SYSTEM_ACTOR);
    return { outcome: "done" };
  }
  await runMarking(admin, p.attempt_id, SYSTEM_ACTOR, { forceHuman: true });
  return { outcome: "skipped", reason: "could not be marked automatically; handed to a person" };
}

/** The automation switch's version of clicking Send. */
export async function sendOutcomeHandler(admin: AdminClient, job: JobRow): Promise<HandlerResult> {
  if (!job.application_id) return { outcome: "failed", error: "send_outcome job missing application", retryable: false };
  const { data: app } = await admin.from("applications").select("id, status").eq("id", job.application_id).single();
  if (!app) return { outcome: "skipped", reason: "application missing" };
  await onOutcomeSent(admin, app, SYSTEM_ACTOR);
  return { outcome: "done" };
}
