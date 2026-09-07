"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function createClosure(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const p = z
      .object({ campusId: z.string().optional(), startsOn: date, endsOn: date, label: z.string().trim().min(1).max(120) })
      .parse(Object.fromEntries(formData));
    if (p.endsOn < p.startsOn) throw new Error("The last day is before the first day.");
    const { error } = await ctx.supabase.from("school_closures").insert({
      campus_id: p.campusId ? p.campusId : null,
      starts_on: p.startsOn,
      ends_on: p.endsOn,
      label: p.label,
      created_by: ctx.userId,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/closures");
  });
}

export async function deleteClosure(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const p = z.object({ closureId: z.uuid() }).parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase.from("school_closures").delete().eq("id", p.closureId);
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/closures");
  });
}
