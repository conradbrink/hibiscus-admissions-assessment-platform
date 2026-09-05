"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";

/**
 * Settings are JSON. The form sends text; this parses it and refuses
 * anything that is not a positive integer or a list of them, which is the
 * only shape any setting currently has.
 */
export async function saveSetting(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const p = z.object({ key: z.string().regex(/^[a-z0-9_]+$/), value: z.string().trim().min(1).max(200) }).parse(Object.fromEntries(formData));
    let value: unknown;
    try {
      value = JSON.parse(p.value);
    } catch {
      throw new Error("Enter a number, or a list like [48, 3].");
    }
    const ok =
      (typeof value === "number" && Number.isInteger(value) && value > 0) ||
      (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "number" && Number.isInteger(v) && v > 0));
    if (!ok) throw new Error("Enter a positive whole number, or a list of them like [48, 3].");
    const { error } = await ctx.supabase
      .from("settings")
      .update({ value: value as number | number[], updated_by: ctx.userId })
      .eq("key", p.key);
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/settings");
  });
}
