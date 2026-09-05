"use server";

import { redirect } from "next/navigation";
import { consumeKioskCode, endKioskSession, openAttemptSession, readKioskSession } from "@/lib/assessment/kiosk-server";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request";
import { getSettings } from "@/lib/settings";
import { drainSoon } from "@/lib/staff/action-helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { onAssessmentSubmitted } from "@/lib/workflow/assessment-actions";
import { KIOSK_ACTOR, WorkflowError } from "@/lib/workflow/engine";

/**
 * The two things a lab computer does: open an attempt with a code, and
 * hand the paper in. Both run under the service role after their own check
 * — the code, or the attempt-scoped cookie — and never trust an id from the
 * form.
 */

export type CodeState = { error?: string };

export async function enterCode(_: CodeState, formData: FormData): Promise<CodeState> {
  const raw = String(formData.get("code") ?? "");
  const admin = createAdminClient();
  const ctx = await requestContext();

  const verdict = await enforceRateLimit(admin, LIMITS.kioskCode, ctx.ipHash ?? "unknown");
  if (!verdict.ok) return { error: "Too many tries from this computer. Please ask your teacher." };

  const result = await consumeKioskCode(admin, raw);
  if (!result.ok) return { error: "That code did not work. Check it with your teacher and try again." };

  const settings = await getSettings(admin);
  const opened = await openAttemptSession(admin, result.attemptId, ctx.userAgent, settings.attemptGraceSeconds);
  if (!opened.ok) return { error: "This assessment cannot be opened. Please ask your teacher." };

  redirect("/sit/assessment");
}

export type SubmitState = { error?: string };

export async function submitAttempt(): Promise<SubmitState> {
  const session = await readKioskSession();
  if (!session) redirect("/sit?reason=expired");
  const admin = createAdminClient();
  const { data: attempt } = await admin.from("attempts").select("*").eq("id", session.attemptId).maybeSingle();
  if (!attempt) redirect("/sit?reason=expired");
  if (attempt.status === "submitted" || attempt.status === "marked") {
    await endKioskSession();
    redirect("/sit/done");
  }
  const { data: app } = await admin.from("applications").select("id, status").eq("id", attempt.application_id).single();
  if (!app) redirect("/sit?reason=expired");
  try {
    await onAssessmentSubmitted(admin, app, attempt, { auto: false }, KIOSK_ACTOR);
  } catch (e) {
    if (e instanceof WorkflowError && e.code === "status_conflict") {
      // Already submitted by the sweep or by staff: that is fine.
    } else {
      console.error("[kiosk] submit failed", e);
      return { error: "Something went wrong handing in. Please tell your teacher." };
    }
  }
  drainSoon();
  await endKioskSession();
  redirect("/sit/done");
}
