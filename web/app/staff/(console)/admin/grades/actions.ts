"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { ED_ADMIN } from "@/lib/enrolment/ed-admin";
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

/**
 * Replaces the whole matrix for one campus with what was ticked.
 *
 * The rows carry the Ed-admin stage name as well as the tick, and that name
 * was typed by a person from another system's dropdown — losing it to a
 * tickbox save would break the student export silently, which is the exact
 * failure the mapping exists to prevent. So the names are read first and put
 * back on the stages that are still ticked.
 */
export async function saveCampusGrades(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const campusId = z.uuid().parse(formData.get("campusId"));
    const gradeIds = formData.getAll("gradeIds").filter((v): v is string => typeof v === "string");

    const { data: existing } = await ctx.supabase
      .from("campus_grades")
      .select("grade_id, external_grade_code")
      .eq("campus_id", campusId);
    const codes = new Map((existing ?? []).map((r) => [r.grade_id, r.external_grade_code]));

    await ctx.supabase.from("campus_grades").delete().eq("campus_id", campusId);
    if (gradeIds.length) {
      const { error } = await ctx.supabase
        .from("campus_grades")
        .insert(gradeIds.map((grade_id) => ({ campus_id: campusId, grade_id, external_grade_code: codes.get(grade_id) ?? null })));
      if (error) throw new Error(error.message);
    }
    revalidatePath("/staff/admin/grades");
    revalidatePath("/staff/admin/ed-admin-grades");
  });
}

/**
 * What Ed-admin calls each stage at one campus.
 *
 * One campus at a time, and only the stages it teaches. The value is copied
 * from Ed-admin's own dropdown and checked against the list we hold, because
 * a near miss (`Stage5 HPS` for `Stage5-HPS`) imports as nothing at all.
 */
export async function saveEdAdminGrades(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const campusId = z.uuid().parse(formData.get("campusId"));
    const allowed = new Set(ED_ADMIN.grades);

    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("code:")) continue;
      const gradeId = key.slice("code:".length);
      if (!z.uuid().safeParse(gradeId).success) continue;
      const code = String(value).trim();
      if (code && !allowed.has(code)) throw new Error(`${code} is not one of Ed-admin's stages.`);
      const { error } = await ctx.supabase
        .from("campus_grades")
        .update({ external_grade_code: code || null })
        .eq("campus_id", campusId)
        .eq("grade_id", gradeId);
      if (error) throw new Error(error.message);
    }
    revalidatePath("/staff/admin/ed-admin-grades");
  });
}
