"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { OpportunityRow } from "@/lib/supabase/types";
import type { StaffActionState } from "@/components/staff/action-form";
import { parseMoneyToMinor } from "@/lib/money";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";

/**
 * An opportunity a person creates or moves. The table's triggers write the
 * audit line and the outbox row and stamp the status dates, so an action
 * here is a plain insert or update through the caller's own client.
 */
export async function createOpportunity(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.write");
    const p = z
      .object({
        familyId: z.guid(),
        studentId: z.string().optional(),
        typeCode: z.string().regex(/^[a-z0-9_]+$/),
        estimatedValue: z.string().trim().optional(),
        notes: z.string().trim().max(2000).optional(),
        assigneeStaffId: z.string().optional(),
      })
      .parse(Object.fromEntries(formData));
    const { data: family } = await ctx.supabase.from("families").select("id, campus_id, assigned_staff_id").eq("id", p.familyId).maybeSingle();
    if (!family?.campus_id) throw new Error("That family has no campus yet; set one first.");
    const value = p.estimatedValue ? parseMoneyToMinor(p.estimatedValue) : null;
    if (p.estimatedValue && value === null) throw new Error("The value must be a number, for example 1500 or 1500.00.");
    const { error } = await ctx.supabase.from("opportunities").insert({
      family_id: family.id,
      student_id: p.studentId || null,
      type_code: p.typeCode,
      campus_id: family.campus_id,
      estimated_value_minor: value,
      notes: p.notes || null,
      assigned_staff_id: p.assigneeStaffId || family.assigned_staff_id || ctx.userId,
      source: "staff",
      created_by: ctx.userId,
    });
    if (error) {
      if (error.code === "23505") throw new Error("This family already has an open opportunity of that type for that child.");
      throw new Error(error.message);
    }
    revalidatePath(`/staff/crm/families/${p.familyId}`);
    revalidatePath("/staff/crm/opportunities");
  });
}

export async function moveOpportunity(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.write");
    const p = z
      .object({
        opportunityId: z.guid(),
        familyId: z.string().optional(),
        status: z.enum(["identified", "contacted", "interested", "registered", "lost"]),
        lostReason: z.string().trim().max(500).optional(),
        actualValue: z.string().trim().optional(),
        nextAction: z.string().trim().max(300).optional(),
        nextActionOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
        assigneeStaffId: z.string().optional(),
      })
      .parse(Object.fromEntries(formData));
    const patch: Partial<OpportunityRow> = { status: p.status };
    if (p.status === "contacted" || p.status === "interested") patch.last_contact_at = new Date().toISOString();
    if (p.status === "lost" && p.lostReason) patch.lost_reason = p.lostReason;
    if (p.actualValue) {
      const v = parseMoneyToMinor(p.actualValue);
      if (v === null) throw new Error("The value must be a number.");
      patch.actual_value_minor = v;
    }
    if (p.nextAction !== undefined) patch.next_action = p.nextAction || null;
    if (p.nextActionOn !== undefined) patch.next_action_at = p.nextActionOn ? `${p.nextActionOn}T07:00:00+02:00` : null;
    if (p.assigneeStaffId !== undefined && p.assigneeStaffId !== "") patch.assigned_staff_id = p.assigneeStaffId;
    const { data, error } = await ctx.supabase.from("opportunities").update(patch).eq("id", p.opportunityId).select("family_id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("That opportunity is not one you can edit.");
    revalidatePath(`/staff/crm/families/${data.family_id}`);
    revalidatePath("/staff/crm/opportunities");
  });
}
