"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { TaskRow } from "@/lib/supabase/types";
import type { StaffActionState } from "@/components/staff/action-form";
import { notifyStaff } from "@/lib/crm/notifications";
import { can } from "@/lib/permissions";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A CRM task: about a family, and so about one of its children or, before
 * any is enrolled, its newest application, or failing both its campus —
 * the three subjects `tasks_has_a_subject` admits. The same table the
 * engine and the admissions console use, so the person's badge and the
 * campus list are one list.
 */
const dueSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal(""));

export async function createCrmTask(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.write");
    if (!can(ctx.permissions, "tasks.write") && !can(ctx.permissions, "applications.write") && !can(ctx.permissions, "crm.write")) throw new Error("You may not create tasks.");
    const p = z
      .object({
        familyId: z.guid(),
        studentId: z.string().optional(),
        title: z.string().trim().min(3, "Give the task a title.").max(200),
        details: z.string().trim().max(2000).optional(),
        assigneeStaffId: z.string().optional(),
        dueOn: dueSchema,
        priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
      })
      .parse(Object.fromEntries(formData));

    const { data: family } = await ctx.supabase.from("families").select("id, campus_id, display_name, family_code").eq("id", p.familyId).maybeSingle();
    if (!family) throw new Error("That family is not one you can see.");
    const studentId = p.studentId || null;
    if (studentId) {
      const { data: s } = await ctx.supabase.from("students").select("id").eq("id", studentId).eq("family_id", family.id).maybeSingle();
      if (!s) throw new Error("That child is not on this family.");
    }
    let applicationId: string | null = null;
    if (!studentId) {
      const { data: app } = await ctx.supabase.from("applications").select("id, contacts!applications_contact_id_fkey!inner(family_id)").eq("contacts.family_id", family.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      applicationId = app?.id ?? null;
    }
    if (!studentId && !applicationId && !family.campus_id) throw new Error("This family has no child, no application and no campus to hang a task on.");

    // Written under the service role because `tasks_insert` requires
    // `tasks.write` or `applications.write`, and a CRM writer holds
    // neither; the checks above — family visible, child on the family —
    // are the CRM's equivalent, and the row is stamped with who wrote it.
    const admin = createAdminClient();
    const { error } = await admin.from("tasks").insert({
      student_id: studentId,
      application_id: studentId ? null : applicationId,
      campus_id: family.campus_id,
      type: "crm_task",
      title: p.title,
      details: p.details || `About the ${family.display_name ?? family.family_code} family.`,
      priority: p.priority,
      due_at: p.dueOn ? `${p.dueOn}T07:00:00+02:00` : null,
      assignee_staff_id: p.assigneeStaffId || null,
      created_by_type: "staff",
      created_by: ctx.userId,
    });
    if (error) throw new Error(error.message);
    if (p.assigneeStaffId && p.assigneeStaffId !== ctx.userId) {
      await notifyStaff(admin, p.assigneeStaffId, { kind: "task_assigned", title: p.title, body: `About the ${family.display_name ?? family.family_code} family.`, href: `/staff/crm/families/${family.id}`, familyId: family.id });
    }
    revalidatePath(`/staff/crm/families/${family.id}`);
    revalidatePath("/staff/crm/tasks");
    revalidatePath("/staff/crm");
  });
}

/** The assignee always may; anyone who writes tasks or the CRM may cover for somebody away. */
export async function completeCrmTask(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.read");
    const p = z.object({ taskId: z.guid(), familyId: z.string().optional(), note: z.string().trim().max(500).optional() }).parse(Object.fromEntries(formData));
    const { data: task } = await ctx.supabase.from("tasks").select("assignee_staff_id, status").eq("id", p.taskId).maybeSingle();
    if (!task) throw new Error("That task is no longer there.");
    const mine = task.assignee_staff_id === ctx.userId;
    if (!mine && !can(ctx.permissions, "tasks.write") && !can(ctx.permissions, "applications.write") && !can(ctx.permissions, "crm.write")) throw new Error("That task belongs to somebody else.");
    const client = mine || can(ctx.permissions, "tasks.write") || can(ctx.permissions, "applications.write") ? ctx.supabase : createAdminClient();
    const { error } = await client.from("tasks").update({ status: "done", resolved_at: new Date().toISOString(), resolved_by: ctx.userId, resolution_note: p.note || null }).eq("id", p.taskId).eq("status", "open");
    if (error) throw new Error(error.message);
    if (p.familyId) revalidatePath(`/staff/crm/families/${p.familyId}`);
    revalidatePath("/staff/crm/tasks");
    revalidatePath("/staff/crm");
  });
}

export async function updateCrmTask(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.write");
    const p = z.object({ taskId: z.guid(), assigneeStaffId: z.string().optional(), status: z.enum(["open", "done", "cancelled"]).optional(), priority: z.enum(["low", "normal", "high", "urgent"]).optional(), dueOn: dueSchema }).parse(Object.fromEntries(formData));
    const { data: task } = await ctx.supabase.from("tasks").select("id, assignee_staff_id, title").eq("id", p.taskId).maybeSingle();
    if (!task) throw new Error("That task is no longer there.");
    const admin = createAdminClient();
    const patch: Partial<TaskRow> = {};
    if (p.assigneeStaffId !== undefined) patch.assignee_staff_id = p.assigneeStaffId || null;
    if (p.priority) patch.priority = p.priority;
    if (p.dueOn !== undefined) patch.due_at = p.dueOn ? `${p.dueOn}T07:00:00+02:00` : null;
    if (p.status) {
      patch.status = p.status;
      if (p.status !== "open") {
        patch.resolved_at = new Date().toISOString();
        patch.resolved_by = ctx.userId;
      } else {
        patch.resolved_at = null;
        patch.resolved_by = null;
      }
    }
    const { error } = await admin.from("tasks").update(patch).eq("id", p.taskId);
    if (error) throw new Error(error.message);
    if (p.assigneeStaffId && p.assigneeStaffId !== task.assignee_staff_id && p.assigneeStaffId !== ctx.userId) {
      await notifyStaff(admin, p.assigneeStaffId, { kind: "task_assigned", title: task.title, href: "/staff/crm/tasks?filter=mine" });
    }
    revalidatePath("/staff/crm/tasks");
  });
}
