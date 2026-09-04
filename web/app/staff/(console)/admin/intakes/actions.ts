"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function createAcademicYear(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const p = z.object({ label: z.string().trim().min(2).max(20), startsOn: date, endsOn: date, ageCutoffOn: date }).parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase.from("academic_years").insert({ label: p.label, starts_on: p.startsOn, ends_on: p.endsOn, age_cutoff_on: p.ageCutoffOn });
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/intakes");
  });
}

export async function createIntake(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const p = z.object({ academicYearId: z.uuid(), term: z.coerce.number().int().min(1).max(3), label: z.string().trim().min(2).max(40), startsOn: date }).parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase.from("intakes").insert({ academic_year_id: p.academicYearId, term: p.term, label: p.label, starts_on: p.startsOn, sort_order: p.term * 10 });
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/intakes");
  });
}

export async function setIntakeOpen(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const p = z.object({ intakeId: z.uuid(), open: z.enum(["0", "1"]) }).parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase.from("intakes").update({ is_open: p.open === "1" }).eq("id", p.intakeId);
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/intakes");
  });
}
