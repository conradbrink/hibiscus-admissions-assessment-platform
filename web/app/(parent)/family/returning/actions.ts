"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { confirmDetails, saveAnswer } from "@/lib/family/reenrolment";
import { familyClient, NotInFamilyError } from "@/lib/family/scope";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { requireFamilySession } from "@/lib/tokens/server";

export type FamilyActionState = { error?: string; ok?: boolean };

const answerSchema = z.object({
  responseId: z.guid(),
  intent: z.enum(["returning", "not_returning", "undecided"]),
  reason: z.string().trim().max(500).optional(),
});

/**
 * One answer from a parent. Every id is checked against the session's own
 * family inside `saveAnswer` — nothing here trusts a value because it came
 * back from a page we rendered.
 */
export async function answerReturning(
  _prev: FamilyActionState,
  formData: FormData
): Promise<FamilyActionState> {
  const session = await requireFamilySession();
  const admin = familyClient();
  const verdict = await enforceRateLimit(admin, LIMITS.parentBooking, session.familyId);
  if (!verdict.ok) return { error: "Too many changes in a short time. Please try again shortly." };

  const parsed = answerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Please choose one of the answers." };

  try {
    await saveAnswer(admin, session, parsed.data.responseId, parsed.data.intent, parsed.data.reason || null);
  } catch (e) {
    if (e instanceof NotInFamilyError) return { error: "That question is not yours to answer." };
    return { error: "We could not save that. Please try again." };
  }
  revalidatePath("/family/returning");
  revalidatePath("/family");
  return { ok: true };
}

const confirmSchema = z.object({
  responseId: z.guid(),
  changed: z.string().trim().max(500).optional(),
});

/**
 * "Everything above is still right." The fields the family says have changed
 * are recorded by name, so the school sees what was wrong rather than only
 * that somebody pressed a button.
 */
export async function confirmFamilyDetails(
  _prev: FamilyActionState,
  formData: FormData
): Promise<FamilyActionState> {
  const session = await requireFamilySession();
  const admin = familyClient();
  const parsed = confirmSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "We could not save that. Please try again." };

  const changed = (parsed.data.changed ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    await confirmDetails(admin, session, parsed.data.responseId, changed);
  } catch (e) {
    if (e instanceof NotInFamilyError) return { error: "That question is not yours to answer." };
    return { error: "We could not save that. Please try again." };
  }
  revalidatePath("/family/returning");
  revalidatePath("/family");
  return { ok: true };
}
