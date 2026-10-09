"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { staffActor } from "@/lib/audit";
import { HrError } from "@/lib/errors";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction, type StaffContext } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { approveSheet, entriesFromForm, reopenSheet, saveEntries } from "@/lib/timesheets";

const campusId = z.string().uuid();
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month.");

async function campusAllowed(ctx: StaffContext, id: string) {
  const { data } = await ctx.supabase.rpc("can_access_campus", { p_campus_id: id });
  if (!data) throw new HrError("You do not have access to that school.");
}

export async function saveTimesheetAction(campus: string, month: string, _: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.timesheets.write");
    await campusAllowed(ctx, campusId.parse(campus));
    await saveEntries(createAdminClient(), staffActor(ctx), { campusId: campus, period: period.parse(month), entries: entriesFromForm(formData) });
    revalidatePath("/staff/timesheets");
  });
}

export async function approveTimesheetAction(campus: string, month: string): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.timesheets.write");
    await campusAllowed(ctx, campusId.parse(campus));
    await approveSheet(createAdminClient(), staffActor(ctx), campus, period.parse(month));
    revalidatePath("/staff/timesheets");
  });
}

export async function reopenTimesheetAction(campus: string, month: string): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.timesheets.write");
    await campusAllowed(ctx, campusId.parse(campus));
    await reopenSheet(createAdminClient(), staffActor(ctx), campus, period.parse(month));
    revalidatePath("/staff/timesheets");
  });
}
