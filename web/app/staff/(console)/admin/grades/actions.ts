"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";

export async function saveGrade(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const p = z
      .object({
        gradeId: z.uuid(),
        name: z.string().trim().min(1).max(60),
        ageTurning: z.union([z.literal(""), z.coerce.number().int().min(0).max(20)]),
        requiresAssessment: z.string().optional(),
        isActive: z.string().optional(),
      })
      .parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase
      .from("grades")
      .update({
        name: p.name,
        age_turning: p.ageTurning === "" ? null : p.ageTurning,
        requires_assessment: p.requiresAssessment === "1",
        is_active: p.isActive === "1",
      })
      .eq("id", p.gradeId);
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/grades");
  });
}

/** Replaces the whole matrix for one campus with what was ticked. */
export async function saveCampusGrades(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const campusId = z.uuid().parse(formData.get("campusId"));
    const gradeIds = formData.getAll("gradeIds").filter((v): v is string => typeof v === "string");
    await ctx.supabase.from("campus_grades").delete().eq("campus_id", campusId);
    if (gradeIds.length) {
      const { error } = await ctx.supabase.from("campus_grades").insert(gradeIds.map((grade_id) => ({ campus_id: campusId, grade_id })));
      if (error) throw new Error(error.message);
    }
    revalidatePath("/staff/admin/grades");
  });
}
