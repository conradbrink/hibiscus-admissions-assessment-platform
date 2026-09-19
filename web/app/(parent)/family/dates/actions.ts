"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { cancelFamilyRegistration, registerFamilyForEvent } from "@/lib/family/events";
import { familyClient, NotInFamilyError } from "@/lib/family/scope";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { requireFamilySession } from "@/lib/tokens/server";

export type FamilyActionState = { error?: string; ok?: boolean };

const registerSchema = z.object({
  eventId: z.guid(),
  studentId: z.string().optional(),
  guests: z.coerce.number().int().min(0).max(10).default(0),
  note: z.string().trim().max(300).optional(),
});

/** "We are coming." Every id is checked against the session's own family in the loader. */
export async function registerForEvent(_prev: FamilyActionState, formData: FormData): Promise<FamilyActionState> {
  const session = await requireFamilySession();
  const admin = familyClient();
  const verdict = await enforceRateLimit(admin, LIMITS.parentBooking, session.familyId);
  if (!verdict.ok) return { error: "Too many changes in a short time. Please try again shortly." };
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "We could not read that. Please try again." };
  try {
    await registerFamilyForEvent(admin, session, {
      eventId: parsed.data.eventId,
      studentId: parsed.data.studentId || null,
      guests: parsed.data.guests,
      note: parsed.data.note || null,
    });
  } catch (e) {
    if (e instanceof NotInFamilyError) return { error: "That date is not one we invited you to." };
    return { error: e instanceof Error ? e.message : "We could not save that. Please try again." };
  }
  revalidatePath("/family/dates");
  return { ok: true };
}

const cancelSchema = z.object({ registrationId: z.guid() });

export async function cancelRegistration(_prev: FamilyActionState, formData: FormData): Promise<FamilyActionState> {
  const session = await requireFamilySession();
  const admin = familyClient();
  const parsed = cancelSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "We could not read that. Please try again." };
  try {
    await cancelFamilyRegistration(admin, session, parsed.data.registrationId);
  } catch (e) {
    if (e instanceof NotInFamilyError) return { error: "That registration is not yours." };
    return { error: "We could not save that. Please try again." };
  }
  revalidatePath("/family/dates");
  return { ok: true };
}
