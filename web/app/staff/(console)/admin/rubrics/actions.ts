"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { RUBRIC_BANDS_SCHEMA } from "@/lib/assessment/bands";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";

/**
 * A rubric's bands arrive as parallel form fields — band_key[], band_label[],
 * band_min[], band_descriptor[] — and are validated as one structure. The
 * top band's marks must not exceed the rubric's maximum, because the marks
 * awarded on assessment day are the band's marks.
 */
function bandsFrom(formData: FormData) {
  const keys = formData.getAll("bandKey").map(String);
  const labels = formData.getAll("bandLabel").map(String);
  const mins = formData.getAll("bandMin").map((v) => Number(v));
  const descs = formData.getAll("bandDescriptor").map(String);
  const rows = keys
    .map((key, i) => ({ key: key.trim(), label: labels[i]?.trim() ?? "", min_marks: mins[i], descriptor: descs[i]?.trim() ?? "" }))
    .filter((b) => b.key || b.label || b.descriptor);
  return RUBRIC_BANDS_SCHEMA.parse(rows);
}

const meta = z.object({
  rubricId: z.uuid().optional().or(z.literal("")),
  name: z.string().trim().min(1).max(120),
  competencyId: z.uuid(),
  maxMarks: z.coerce.number().positive().max(100),
});

export async function saveRubric(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("assessments.author");
    const p = meta.parse({
      rubricId: formData.get("rubricId") ?? "",
      name: formData.get("name"),
      competencyId: formData.get("competencyId"),
      maxMarks: formData.get("maxMarks"),
    });
    let bands;
    try {
      bands = bandsFrom(formData);
    } catch {
      throw new Error("Each band needs a key (lower-case), a label, a minimum mark and a descriptor; at least two bands.");
    }
    if (Math.max(...bands.map((b) => b.min_marks)) > p.maxMarks) throw new Error("A band starts above the rubric's maximum marks.");
    const row = { name: p.name, competency_id: p.competencyId, max_marks: p.maxMarks, bands };
    const { error } = p.rubricId
      ? await ctx.supabase.from("rubrics").update(row).eq("id", p.rubricId)
      : await ctx.supabase.from("rubrics").insert(row);
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/rubrics");
  });
}
