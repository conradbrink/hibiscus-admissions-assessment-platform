"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { staffActor } from "@/lib/audit";
import { addCaseEvent, closeCase, EventSchema, openCase, OpenCaseSchema, OutcomeSchema, recordOutcome } from "@/lib/disciplinary";
import { HrError } from "@/lib/errors";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction, type StaffContext } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";

const id = z.string().uuid();

async function caseFor(ctx: StaffContext, caseId: string) {
  const { data } = await ctx.supabase.from("hr_disciplinary_cases").select("id, employee_id").eq("id", id.parse(caseId)).maybeSingle();
  if (!data) throw new HrError("Case not found.");
  return data;
}

const casePage = (caseId: string) => `/staff/disciplinary/cases/${caseId}`;

export async function openCaseAction(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  let created: string | null = null;
  const state = await guarded(async () => {
    const ctx = await requireStaffAction("hr.disciplinary.write");
    const input = OpenCaseSchema.parse(Object.fromEntries(formData));
    const { data: employee } = await ctx.supabase.from("hr_employees").select("id").eq("id", input.employee_id).maybeSingle();
    if (!employee) throw new HrError("Employee not found.");
    created = await openCase(createAdminClient(), staffActor(ctx), input);
  });
  if (created && state.ok) redirect(casePage(created));
  return state;
}

export async function addEventAction(caseId: string, _: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.disciplinary.write");
    const c = await caseFor(ctx, caseId);
    await addCaseEvent(createAdminClient(), staffActor(ctx), c.id, EventSchema.parse(Object.fromEntries(formData)));
    revalidatePath(casePage(c.id));
  });
}

export async function outcomeAction(caseId: string, _: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.disciplinary.write");
    const c = await caseFor(ctx, caseId);
    await recordOutcome(createAdminClient(), staffActor(ctx), c.id, OutcomeSchema.parse(Object.fromEntries(formData)));
    revalidatePath(casePage(c.id));
    revalidatePath(`/staff/employees/${c.employee_id}`);
  });
}

export async function closeCaseAction(caseId: string, _: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.disciplinary.write");
    const c = await caseFor(ctx, caseId);
    await closeCase(createAdminClient(), staffActor(ctx), c.id, String(formData.get("note") ?? "").trim());
    revalidatePath(casePage(c.id));
  });
}
