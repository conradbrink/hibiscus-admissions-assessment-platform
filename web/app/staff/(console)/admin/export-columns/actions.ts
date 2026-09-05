"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";

const schema = z.object({
  id: z.uuid().optional(),
  position: z.coerce.number().int().min(0).max(100000).default(1000),
  header: z.string().trim().min(1).max(80),
  sourcePath: z.string().trim().regex(/^[a-z_]+(\[[0-9]+\])?(\.[a-z_]+(\[[0-9]+\])?)*$/, "A path like student.date_of_birth or guardians[0].mobile."),
  transform: z.enum(["none", "upper", "date_dmy", "date_ymd", "yes_no", "money"]),
  isActive: z.string().optional(),
});

export async function saveColumn(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const p = schema.parse(Object.fromEntries(formData));
    const row = { position: p.position, header: p.header, source_path: p.sourcePath, transform: p.transform, is_active: p.isActive === "1" };
    const { error } = p.id ? await ctx.supabase.from("export_columns").update(row).eq("id", p.id) : await ctx.supabase.from("export_columns").insert(row);
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/export-columns");
    revalidatePath("/staff/enrolment/exports");
  });
}

export async function deleteColumn(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const { id } = z.object({ id: z.uuid() }).parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase.from("export_columns").delete().eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/export-columns");
    revalidatePath("/staff/enrolment/exports");
  });
}
