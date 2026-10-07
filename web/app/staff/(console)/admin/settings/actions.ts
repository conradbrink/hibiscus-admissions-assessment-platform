"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { fieldFor, parseSetting } from "@/lib/settings/fields";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";

/**
 * Settings are JSON, and the screen now asks for each one in its own terms —
 * a number, a date, a checkbox, a list of times — so this parses what that
 * control sends rather than making somebody type the JSON.
 *
 * `parseSetting` is stricter than `lib/settings.ts`, on purpose. The reader
 * falls back to a default when a value is malformed, which is right at read
 * time and wrong here: somebody who typed a wrong thing should be told, not
 * quietly handed the default and left believing it saved.
 *
 * A key nothing has labelled yet still takes raw JSON, which is what this
 * whole page used to be. A migration can add a row today and it stays
 * editable until somebody gets round to labelling it.
 */
export async function saveSetting(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const p = z
      .object({ key: z.string().regex(/^[a-z0-9_]+$/), value: z.string().max(2000).optional() })
      .parse(Object.fromEntries(formData));
    // An unchecked checkbox posts nothing at all, which is a false and not a
    // missing field.
    const raw = p.value ?? "";
    const field = fieldFor(p.key);

    let value: string | number | boolean | number[];
    if (field) {
      value = parseSetting(field.kind, raw, field.label);
    } else {
      if (raw.trim() === "") throw new Error("Enter a value.");
      try {
        value = JSON.parse(raw) as string | number | boolean | number[];
      } catch {
        throw new Error("This setting has no form field yet, so it takes JSON: a number, a list like [48, 3], \"text\", or true/false.");
      }
    }

    const { error } = await ctx.supabase
      .from("settings")
      .update({ value, updated_by: ctx.userId })
      .eq("key", p.key);
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/settings");
  });
}
