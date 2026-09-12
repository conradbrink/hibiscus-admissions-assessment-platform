"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { can } from "@/lib/permissions";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";

/**
 * Tasks a person writes, as opposed to the ones the engine opens.
 *
 * Kept apart from the applicant's own actions because the permission is
 * different: `tasks.write` rather than `applications.write`. Management may
 * set a task for somebody and may not touch an applicant, and reusing the
 * applicant permission here would have quietly handed them the second.
 */

const dueSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .or(z.literal(""));

export async function createTask(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("tasks.write");
    const parsed = z
      .object({
        title: z.string().trim().min(3, "Give the task a title.").max(200),
        details: z.string().trim().max(2000).optional(),
        campusId: z.guid("Choose the campus this is for."),
        assigneeStaffId: z.string().optional(),
        dueOn: dueSchema,
        priority: z.enum(["low", "normal", "high"]).default("normal"),
      })
      .parse(Object.fromEntries(formData));

    // A task must name a subject — an applicant, a child, or a campus
    // (`tasks_has_a_subject`). One somebody writes by hand names the campus,
    // which is also what scopes it: a Phase 2 task is Phase 2's business.
    const { error } = await ctx.supabase.from("tasks").insert({
      campus_id: parsed.campusId,
      type: "staff_task",
      title: parsed.title,
      details: parsed.details || null,
      priority: parsed.priority,
      // 07:00 at the campus, so "due Friday" means the start of Friday rather
      // than midnight, which reads as Thursday night on the overdue filter.
      due_at: parsed.dueOn ? `${parsed.dueOn}T07:00:00+02:00` : null,
      assignee_staff_id: parsed.assigneeStaffId || null,
      created_by_type: "staff",
      created_by: ctx.userId,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/staff/tasks");
    revalidatePath("/staff");
  });
}

/**
 * Tick it off.
 *
 * The assignee may always complete their own, whatever else they hold — that
 * is what being given a task means, and the policy agrees (`tasks_update`).
 * Anybody who may write tasks, or edit applicants, may complete somebody
 * else's: work gets covered when people are away.
 */
export async function markTaskDone(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.read");
    const { taskId } = z.object({ taskId: z.guid() }).parse(Object.fromEntries(formData));

    const { data: task } = await ctx.supabase.from("tasks").select("assignee_staff_id").eq("id", taskId).maybeSingle();
    if (!task) throw new Error("That task is no longer there.");
    const mine = task.assignee_staff_id === ctx.userId;
    if (!mine && !can(ctx.permissions, "tasks.write") && !can(ctx.permissions, "applications.write")) {
      throw new Error("That task belongs to somebody else.");
    }

    const { error } = await ctx.supabase
      .from("tasks")
      .update({ status: "done", resolved_at: new Date().toISOString(), resolved_by: ctx.userId })
      .eq("id", taskId)
      .eq("status", "open");
    if (error) throw new Error(error.message);
    revalidatePath("/staff/tasks");
    revalidatePath("/staff");
  });
}

/** Ticked the wrong one. Open it again — the same people who may complete it. */
export async function reopenTask(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.read");
    const { taskId } = z.object({ taskId: z.guid() }).parse(Object.fromEntries(formData));

    const { data: task } = await ctx.supabase.from("tasks").select("assignee_staff_id").eq("id", taskId).maybeSingle();
    if (!task) throw new Error("That task is no longer there.");
    const mine = task.assignee_staff_id === ctx.userId;
    if (!mine && !can(ctx.permissions, "tasks.write") && !can(ctx.permissions, "applications.write")) {
      throw new Error("That task belongs to somebody else.");
    }

    const { error } = await ctx.supabase
      .from("tasks")
      .update({ status: "open", resolved_at: null, resolved_by: null, resolution_note: null })
      .eq("id", taskId)
      .eq("status", "done");
    if (error) throw new Error(error.message);
    revalidatePath("/staff/tasks");
    revalidatePath("/staff");
  });
}
