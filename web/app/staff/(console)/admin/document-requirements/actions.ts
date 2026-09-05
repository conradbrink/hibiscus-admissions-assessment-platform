"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";

const bound = z.union([z.literal(""), z.coerce.number().int()]).optional().transform((v) => (v === "" || v === undefined ? null : v));

const schema = z.object({
  code: z.string().regex(/^[a-z0-9_]+$/, "Code: lower-case letters, digits and underscores."),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).optional(),
  required: z.string().optional(),
  gradeSortMin: bound,
  gradeSortMax: bound,
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  isActive: z.string().optional(),
});

export async function saveRequirement(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const p = schema.parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase.from("document_requirements").upsert(
      {
        code: p.code,
        label: p.label,
        description: p.description || null,
        required: p.required === "1",
        grade_sort_min: p.gradeSortMin,
        grade_sort_max: p.gradeSortMax,
        sort_order: p.sortOrder,
        is_active: p.isActive !== "0",
      },
      { onConflict: "code" }
    );
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/document-requirements");
  });
}
