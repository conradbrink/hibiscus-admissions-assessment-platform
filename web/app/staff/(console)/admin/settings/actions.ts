"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";

/**
 * Settings are JSON. The form sends text; this parses it and refuses
 * anything that is not one of the three shapes a setting can have: a
 * positive integer, a list of them, or (from Phase 2) true/false for the
 * automation switches. The reader in lib/settings.ts is just as strict, so
 * a value that gets past here is one the engine will honour.
 */
export async function saveSetting(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const p = z.object({ key: z.string().regex(/^[a-z0-9_]+$/), value: z.string().trim().min(1).max(200) }).parse(Object.fromEntries(formData));
    let value: unknown;
    try {
      value = JSON.parse(p.value);
    } catch {
      throw new Error("Enter a number, a list like [48, 3], or true/false.");
    }
    const ok =
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isInteger(value) && value > 0) ||
      (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "number" && Number.isInteger(v) && v > 0));
    if (!ok) throw new Error("Enter a positive whole number, a list of them like [48, 3], or true/false.");
    const { error } = await ctx.supabase
      .from("settings")
      .update({ value: value as number | number[] | boolean, updated_by: ctx.userId })
      .eq("key", p.key);
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/settings");
  });
}
