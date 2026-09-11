"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FamilyActionState } from "@/app/(parent)/family/returning/actions";
import { cancelExtra, chooseExtra } from "@/lib/family/extras";
import { familyClient } from "@/lib/family/scope";
import { toSchoolDateString } from "@/lib/format-date";
import { requireFamilySession } from "@/lib/tokens/server";

/**
 * Choosing and un-choosing an extra.
 *
 * Neither action trusts anything in the form beyond the ids: the child is
 * checked against the session, the item against what that child is offered,
 * and the price is read from the catalogue. A parent posting their own
 * `amount_minor` is the obvious attack, so the form never carries one.
 */

const chooseSchema = z.object({
  studentId: z.guid(),
  itemId: z.guid(),
  quantity: z.coerce.number().int().min(1).max(20).default(1),
  choice: z.string().trim().max(120).optional(),
});

const cancelSchema = z.object({ studentId: z.guid(), selectionId: z.guid() });

async function guarded(run: () => Promise<void>): Promise<FamilyActionState> {
  try {
    await run();
    revalidatePath("/family/extras");
    return { ok: true };
  } catch (e) {
    // The messages thrown by `lib/family/extras` are written for a parent to
    // read — "the date for ordering this has passed" — so they are shown as
    // they are rather than replaced with something vaguer.
    return { error: e instanceof Error ? e.message : "We could not save that. Please try again." };
  }
}

export async function choose(_: FamilyActionState, formData: FormData): Promise<FamilyActionState> {
  return guarded(async () => {
    const session = await requireFamilySession();
    const p = chooseSchema.parse(Object.fromEntries(formData));
    await chooseExtra(
      familyClient(),
      session,
      { studentId: p.studentId, itemId: p.itemId, quantity: p.quantity, choice: p.choice || null },
      toSchoolDateString(new Date())
    );
  });
}

export async function cancel(_: FamilyActionState, formData: FormData): Promise<FamilyActionState> {
  return guarded(async () => {
    const session = await requireFamilySession();
    const p = cancelSchema.parse(Object.fromEntries(formData));
    await cancelExtra(familyClient(), session, p);
  });
}
