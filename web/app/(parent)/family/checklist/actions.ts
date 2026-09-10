"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { completeItem } from "@/lib/family/onboarding";
import { familyClient, NotInFamilyError } from "@/lib/family/scope";
import { requireFamilySession } from "@/lib/tokens/server";
import type { FamilyActionState } from "@/app/(parent)/family/returning/actions";

const schema = z.object({
  itemId: z.uuid(),
  /** The answer a `choice` step asks for; empty for an acknowledgement. */
  choice: z.string().trim().max(200).optional(),
});

/**
 * Ticks one item off a family's checklist.
 *
 * The id is verified against this family's own items inside `completeItem`,
 * and a step the school owns is refused there too — a parent cannot mark
 * "allocate the class" done on the school's behalf.
 */
export async function completeChecklistItem(
  _prev: FamilyActionState,
  formData: FormData
): Promise<FamilyActionState> {
  const session = await requireFamilySession();
  const admin = familyClient();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "We could not save that. Please try again." };

  try {
    await completeItem(
      admin,
      session,
      parsed.data.itemId,
      parsed.data.choice ? { choice: parsed.data.choice } : {}
    );
  } catch (e) {
    if (e instanceof NotInFamilyError) return { error: "That is not yours to tick off." };
    return { error: "We could not save that. Please try again." };
  }
  revalidatePath("/family/checklist");
  revalidatePath("/family");
  return { ok: true };
}
