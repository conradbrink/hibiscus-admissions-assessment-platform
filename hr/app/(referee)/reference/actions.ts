"use server";

import { redirect } from "next/navigation";
import { HrError } from "@/lib/errors";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request";
import { declineReference, RATING_KEYS, ReferenceFormSchema, submitReference } from "@/lib/references";
import { drainSoon } from "@/lib/staff/action-helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { endRefereeSession, readRefereeSession } from "@/lib/tokens/server";

export type RefereeState = { error?: string; fieldErrors?: Record<string, string> };

export async function submitReferenceAction(_prev: RefereeState, formData: FormData): Promise<RefereeState> {
  const session = await readRefereeSession();
  if (!session) return { error: "This page has timed out. Please open the link in your email again." };
  const raw = Object.fromEntries(formData) as Record<string, string>;
  const parsed = ReferenceFormSchema.safeParse({
    ...raw,
    ratings: Object.fromEntries(RATING_KEYS.map((k) => [k, raw[`rating_${k}`]])),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] ??= issue.message.startsWith("Invalid") || issue.message.startsWith("Too") || issue.message.includes("expected") ? "Please answer this question." : issue.message;
    return { error: "Please answer the questions marked below.", fieldErrors };
  }
  const admin = createAdminClient();
  const verdict = await enforceRateLimit(admin, LIMITS.referenceSubmit, `ref:${session.referenceRequestId}`, { strict: true });
  if (!verdict.ok) return { error: "Please wait a moment and try again." };
  const ctx = await requestContext();
  try {
    await submitReference(admin, session.referenceRequestId, parsed.data, ctx.ipHash);
  } catch (e) {
    if (e instanceof HrError) return { error: e.message };
    console.error("[reference] submit failed", e);
    return { error: "We could not save your reference. Please try again." };
  }
  drainSoon();
  await endRefereeSession();
  redirect("/reference/thanks");
}

export async function declineReferenceAction(_prev: RefereeState, formData: FormData): Promise<RefereeState> {
  const session = await readRefereeSession();
  if (!session) return { error: "This page has timed out. Please open the link in your email again." };
  const ctx = await requestContext();
  try {
    await declineReference(createAdminClient(), session.referenceRequestId, String(formData.get("reason") ?? ""), ctx.ipHash);
  } catch (e) {
    if (e instanceof HrError) return { error: e.message };
    throw e;
  }
  drainSoon();
  await endRefereeSession();
  redirect("/reference/thanks?declined=1");
}
