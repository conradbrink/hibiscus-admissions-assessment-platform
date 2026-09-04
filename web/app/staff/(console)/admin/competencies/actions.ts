"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";

export async function saveCompetency(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("assessments.author");
    const p = z
      .object({
        competencyId: z.uuid(),
        name: z.string().trim().min(1).max(80),
        focusLabel: z.string().trim().max(80).optional(),
        sortOrder: z.coerce.number().int().min(0).max(1000),
        reportable: z.string().optional(),
        isActive: z.string().optional(),
      })
      .parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase
      .from("competencies")
      .update({
        name: p.name,
        focus_label: p.focusLabel || null,
        sort_order: p.sortOrder,
        reportable: p.reportable === "1",
        is_active: p.isActive === "1",
      })
      .eq("id", p.competencyId);
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/competencies");
  });
}

export async function addCompetency(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("assessments.author");
    const p = z
      .object({
        subjectId: z.uuid(),
        code: z.string().regex(/^[a-z0-9_]+$/).max(40),
        name: z.string().trim().min(1).max(80),
        focusLabel: z.string().trim().max(80).optional(),
      })
      .parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase
      .from("competencies")
      .insert({ subject_id: p.subjectId, code: p.code, name: p.name, focus_label: p.focusLabel || null, sort_order: 100 });
    if (error) throw new Error(error.message.includes("unique") ? "That code is already used." : error.message);
    revalidatePath("/staff/admin/competencies");
  });
}
