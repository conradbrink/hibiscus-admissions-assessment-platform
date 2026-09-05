"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";

const createSchema = z.object({
  kind: z.enum(["assessment", "visit"]),
  campusId: z.uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  durationMinutes: z.coerce.number().int().min(15).max(480),
  capacity: z.coerce.number().int().min(1).max(200),
  minGradeSort: z.coerce.number().int().optional().or(z.literal("")),
  maxGradeSort: z.coerce.number().int().optional().or(z.literal("")),
  assessorStaffId: z.string().optional(),
  location: z.string().trim().max(120).optional(),
  repeatWeeks: z.coerce.number().int().min(1).max(12).default(1),
  publish: z.string().optional(),
});

/**
 * Creates a session, or a weekly run of them. Times are entered in the
 * school's zone (UTC+2, no daylight saving) and stored as instants.
 */
export async function createSessions(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const p = createSchema.parse(Object.fromEntries(formData));
    const first = new Date(`${p.date}T${p.startTime}:00+02:00`);
    if (Number.isNaN(first.getTime())) throw new Error("Invalid date or time.");

    const rows = Array.from({ length: p.repeatWeeks }, (_, i) => {
      const start = new Date(first.getTime() + i * 7 * 86_400_000);
      const end = new Date(start.getTime() + p.durationMinutes * 60_000);
      return {
        kind: p.kind,
        campus_id: p.campusId,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        capacity: p.capacity,
        min_grade_sort: p.minGradeSort === "" || p.minGradeSort === undefined ? null : p.minGradeSort,
        max_grade_sort: p.maxGradeSort === "" || p.maxGradeSort === undefined ? null : p.maxGradeSort,
        assessor_staff_id: p.assessorStaffId || null,
        location: p.location || null,
        is_published: p.publish === "1",
        created_by: ctx.userId,
      };
    });
    const { error } = await ctx.supabase.from("sessions").insert(rows);
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/sessions");
  });
}

export async function setPublished(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const p = z.object({ sessionId: z.uuid(), published: z.enum(["0", "1"]) }).parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase
      .from("sessions")
      .update({ is_published: p.published === "1" })
      .eq("id", p.sessionId);
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/sessions");
  });
}

export async function deleteSession(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const p = z.object({ sessionId: z.uuid() }).parse(Object.fromEntries(formData));
    // RLS refuses the delete while anybody is booked; PostgREST reports
    // zero rows rather than an error, so check.
    const { data, error } = await ctx.supabase.from("sessions").delete().eq("id", p.sessionId).select("id");
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error("Not deleted — somebody is booked on it. Unpublish it instead.");
    revalidatePath("/staff/admin/sessions");
  });
}
