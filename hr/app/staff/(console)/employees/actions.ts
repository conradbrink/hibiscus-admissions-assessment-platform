"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { staffActor } from "@/lib/audit";
import { HrError } from "@/lib/errors";
import { addContract, ContractSchema, createEmployee, EmployeeSchema, PrivateSchema, savePrivate, setEmploymentStatus, StatusSchema, updateEmployee } from "@/lib/employees";
import { addPayItem, BankSchema, CompensationSchema, endPayItem, PayItemSchema, saveBank, setCompensation, verifyBank } from "@/lib/employees/pay";
import { can } from "@/lib/permissions";
import { decideLeave, LeaveRequestSchema, recordLeave, setEntitlement } from "@/lib/leave";
import { acknowledgeWarning } from "@/lib/disciplinary";
import { drainSoon, guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction, type StaffContext } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Every change to an employee. Each action checks the permission, reads the
 * employee through the person's own client (so another campus answers "not
 * found"), and only then writes under the service role, with an audit row.
 */

const id = z.string().uuid();

async function employeeFor(ctx: StaffContext, employeeId: string) {
  const { data } = await ctx.supabase.from("hr_employees").select("id, campus_id").eq("id", id.parse(employeeId)).maybeSingle();
  if (!data) throw new HrError("Employee not found.");
  return data;
}

async function campusAllowed(ctx: StaffContext, campusId: string) {
  const { data } = await ctx.supabase.rpc("can_access_campus", { p_campus_id: campusId });
  if (!data) throw new HrError("You do not have access to that school.");
}

function employeeInput(formData: FormData) {
  return EmployeeSchema.parse({ ...Object.fromEntries(formData), is_teaching: formData.get("is_teaching") === "on" });
}

const page = (employeeId: string) => `/staff/employees/${employeeId}`;

export async function createEmployeeAction(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  let created: string | null = null;
  const state = await guarded(async () => {
    const ctx = await requireStaffAction("hr.employees.write");
    const input = employeeInput(formData);
    await campusAllowed(ctx, input.campus_id);
    created = await createEmployee(createAdminClient(), staffActor(ctx), input);
  });
  if (created && state.ok) redirect(page(created));
  return state;
}

export async function updateEmployeeAction(employeeId: string, _: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.employees.write");
    await employeeFor(ctx, employeeId);
    const input = employeeInput(formData);
    await campusAllowed(ctx, input.campus_id);
    await updateEmployee(createAdminClient(), staffActor(ctx), employeeId, input);
    revalidatePath(page(employeeId));
  });
}

export async function setStatusAction(employeeId: string, _: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.employees.write");
    await employeeFor(ctx, employeeId);
    await setEmploymentStatus(createAdminClient(), staffActor(ctx), employeeId, StatusSchema.parse(Object.fromEntries(formData)));
    revalidatePath(page(employeeId));
  });
}

export async function savePrivateAction(employeeId: string, _: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.employees.write");
    if (!can(ctx.permissions, "hr.employees.sensitive.read")) throw new HrError("You do not have permission to change personal details.");
    await employeeFor(ctx, employeeId);
    await savePrivate(createAdminClient(), staffActor(ctx), employeeId, PrivateSchema.parse(Object.fromEntries(formData)));
    revalidatePath(page(employeeId));
  });
}

export async function addContractAction(employeeId: string, _: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.employees.write");
    await employeeFor(ctx, employeeId);
    await addContract(createAdminClient(), staffActor(ctx), employeeId, ContractSchema.parse(Object.fromEntries(formData)));
    revalidatePath(page(employeeId));
  });
}

// ---------------------------------------------------------------------------
// Pay (strict: the admissions super administrator is not enough)
// ---------------------------------------------------------------------------

async function campusCurrency(ctx: StaffContext, campusId: string): Promise<"BWP" | "ZAR"> {
  const { data } = await ctx.supabase.from("campuses").select("currency").eq("id", campusId).single();
  if (!data) throw new HrError("School not found.");
  return data.currency;
}

export async function setCompensationAction(employeeId: string, _: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.compensation.write");
    const e = await employeeFor(ctx, employeeId);
    await setCompensation(createAdminClient(), staffActor(ctx), employeeId, await campusCurrency(ctx, e.campus_id), CompensationSchema.parse(Object.fromEntries(formData)));
    revalidatePath(page(employeeId));
  });
}

export async function addPayItemAction(employeeId: string, _: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.compensation.write");
    await employeeFor(ctx, employeeId);
    await addPayItem(createAdminClient(), staffActor(ctx), employeeId, PayItemSchema.parse(Object.fromEntries(formData)));
    revalidatePath(page(employeeId));
  });
}

export async function endPayItemAction(employeeId: string, itemId: string, _: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.compensation.write");
    await employeeFor(ctx, employeeId);
    const endOn = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the last day.").parse(formData.get("end_on"));
    await endPayItem(createAdminClient(), staffActor(ctx), employeeId, id.parse(itemId), endOn);
    revalidatePath(page(employeeId));
  });
}

export async function saveBankAction(employeeId: string, _: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.compensation.write");
    await employeeFor(ctx, employeeId);
    await saveBank(createAdminClient(), staffActor(ctx), employeeId, BankSchema.parse(Object.fromEntries(formData)));
    revalidatePath(page(employeeId));
  });
}

export async function verifyBankAction(employeeId: string): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.compensation.write");
    await employeeFor(ctx, employeeId);
    await verifyBank(createAdminClient(), staffActor(ctx), employeeId);
    revalidatePath(page(employeeId));
  });
}

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

export async function recordLeaveAction(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.leave.approve");
    const input = LeaveRequestSchema.parse(Object.fromEntries(formData));
    await employeeFor(ctx, input.employee_id);
    await recordLeave(createAdminClient(), staffActor(ctx), input, { canApprove: true });
    revalidatePath(page(input.employee_id));
    revalidatePath("/staff/leave");
  });
}

export async function decideLeaveAction(requestId: string, _: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.leave.approve");
    const { data: req } = await ctx.supabase.from("hr_leave_requests").select("id, employee_id").eq("id", id.parse(requestId)).maybeSingle();
    if (!req) throw new HrError("Leave request not found.");
    const decision = z.enum(["approved", "declined", "cancelled"]).parse(formData.get("decision"));
    const note = z.string().trim().max(1000).parse(formData.get("note") ?? "") || null;
    await decideLeave(createAdminClient(), staffActor(ctx), { requestId: req.id, decision, note, notify: formData.get("notify") === "on" });
    drainSoon();
    revalidatePath(page(req.employee_id));
    revalidatePath("/staff/leave");
  });
}

export async function setEntitlementAction(employeeId: string, _: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.leave.approve");
    await employeeFor(ctx, employeeId);
    const raw = String(formData.get("days") ?? "").trim();
    await setEntitlement(createAdminClient(), staffActor(ctx), {
      employeeId,
      code: z.string().regex(/^[a-z][a-z0-9_]*$/).parse(formData.get("code")),
      year: z.coerce.number().int().min(2000).max(2100).parse(formData.get("year")),
      days: raw === "" ? null : z.coerce.number().min(0).max(366).parse(raw),
      note: null,
    });
    revalidatePath(page(employeeId));
  });
}

export async function acknowledgeWarningAction(employeeId: string, warningId: string): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.disciplinary.write");
    await employeeFor(ctx, employeeId);
    await acknowledgeWarning(createAdminClient(), staffActor(ctx), id.parse(warningId));
    revalidatePath(page(employeeId));
  });
}
