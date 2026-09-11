"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";

function done() {
  revalidatePath("/staff/admin/onboarding-steps");
  revalidatePath("/staff/onboarding");
}

const schema = z.object({
  code: z.string().regex(/^[a-z0-9_]+$/),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  required: z.union([z.literal("on"), z.literal("")]).optional(),
  isActive: z.union([z.literal("on"), z.literal("")]).optional(),
  dueOffsetDays: z.string().trim().optional(),
  options: z.string().trim().max(500).optional(),
});

/**
 * Edits one step. The wording a parent reads lives here rather than in code,
 * for the same reason every email does: a step nobody at the school can
 * change is a step that will be wrong by February.
 *
 * The code, the kind and the owner are not editable. Changing a code would
 * orphan every checklist already carrying it, and changing a kind would leave
 * answers of one shape sitting in a step that now asks another.
 */
export async function saveStep(_prev: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const { supabase } = await requireStaffAction("settings.write");
    const parsed = schema.parse(Object.fromEntries(formData));

    const due = parsed.dueOffsetDays?.trim();
    const dueOffset = due ? Number(due) : null;
    if (dueOffset !== null && !Number.isInteger(dueOffset)) {
      throw new Error("The days before the first day must be a whole number.");
    }

    const options = (parsed.options ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const { error } = await supabase
      .from("onboarding_steps")
      .update({
        label: parsed.label,
        description: parsed.description || null,
        required: parsed.required === "on",
        is_active: parsed.isActive === "on",
        due_offset_days: dueOffset,
        options,
      })
      .eq("code", parsed.code);
    if (error) throw new Error(error.message);
    done();
  });
}
