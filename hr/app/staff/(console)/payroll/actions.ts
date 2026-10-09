"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { staffActor } from "@/lib/audit";
import { HrError } from "@/lib/errors";
import { parseMoneyToMinor } from "@/lib/money";
import { queuePayslipEmails } from "@/lib/payroll/payslips";
import { approveRun, calculateRun, createRun, deleteRun, lockRun, setOverride } from "@/lib/payroll/run";
import { publishTaxYear, retireTaxYear, saveDraft } from "@/lib/payroll/tax-years";
import { drainSoon, guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction, type StaffContext } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Payroll actions. Every one needs a strict payroll permission (the
 * admissions super administrator is not enough), and reads the run through
 * the person's own client first, so a run at another campus is "not found".
 */

const id = z.string().uuid();

async function runFor(ctx: StaffContext, runId: string) {
  const { data } = await ctx.supabase.from("hr_payroll_runs").select("id, campus_id, status").eq("id", id.parse(runId)).maybeSingle();
  if (!data) throw new HrError("Payroll run not found.");
  return data;
}

const runPage = (runId: string) => `/staff/payroll/runs/${runId}`;

export async function createRunAction(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  let created: string | null = null;
  const state = await guarded(async () => {
    const ctx = await requireStaffAction("hr.payroll.prepare");
    const campusId = id.parse(formData.get("campus_id"));
    const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month.").parse(formData.get("period"));
    const { data: ok } = await ctx.supabase.rpc("can_access_campus", { p_campus_id: campusId });
    if (!ok) throw new HrError("You do not have access to that school.");
    const admin = createAdminClient();
    created = await createRun(admin, staffActor(ctx), { campusId, period });
    // A run that cannot be calculated yet (a draft tax table, say) still
    // opens: its page shows why, with the button to try again.
    try {
      await calculateRun(admin, staffActor(ctx), created);
    } catch (e) {
      if (!(e instanceof HrError)) throw e;
    }
  });
  if (created && state.ok) redirect(runPage(created));
  return state;
}

export async function calculateRunAction(runId: string): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.payroll.prepare");
    const run = await runFor(ctx, runId);
    await calculateRun(createAdminClient(), staffActor(ctx), run.id);
    revalidatePath(runPage(run.id));
  });
}

export async function overrideAction(runId: string, employeeId: string, code: string, _: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.payroll.prepare");
    const run = await runFor(ctx, runId);
    const raw = String(formData.get("amount") ?? "").trim();
    const amountMinor = raw === "" ? null : parseMoneyToMinor(raw);
    if (raw !== "" && amountMinor === null) throw new HrError("Enter an amount, like 1250 or 1,250.00.");
    await setOverride(createAdminClient(), staffActor(ctx), {
      runId: run.id,
      employeeId: id.parse(employeeId),
      code: z.string().regex(/^[A-Z][A-Z0-9_]*$/).parse(code),
      amountMinor,
      reason: String(formData.get("reason") ?? ""),
    });
    revalidatePath(runPage(run.id));
  });
}

export async function approveRunAction(runId: string): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.payroll.approve");
    const run = await runFor(ctx, runId);
    await approveRun(createAdminClient(), staffActor(ctx), run.id);
    revalidatePath(runPage(run.id));
  });
}

export async function lockRunAction(runId: string): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.payroll.approve");
    const run = await runFor(ctx, runId);
    await lockRun(createAdminClient(), staffActor(ctx), run.id);
    revalidatePath(runPage(run.id));
  });
}

export async function deleteRunAction(runId: string): Promise<StaffActionState> {
  let deleted = false;
  const state = await guarded(async () => {
    const ctx = await requireStaffAction("hr.payroll.prepare");
    const run = await runFor(ctx, runId);
    await deleteRun(createAdminClient(), staffActor(ctx), run.id);
    deleted = true;
  });
  if (deleted) redirect("/staff/payroll");
  return state;
}

export async function emailPayslipsAction(runId: string): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.payroll.approve");
    const run = await runFor(ctx, runId);
    await queuePayslipEmails(createAdminClient(), staffActor(ctx), run.id);
    drainSoon();
    revalidatePath(runPage(run.id));
  });
}

// ---------------------------------------------------------------------------
// Tax tables
// ---------------------------------------------------------------------------

export async function saveTaxDraftAction(taxYearId: string, _: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.tax_tables.write");
    await saveDraft(createAdminClient(), staffActor(ctx), id.parse(taxYearId), {
      resident: String(formData.get("resident") ?? ""),
      nonResident: String(formData.get("non_resident") ?? ""),
      parameters: String(formData.get("parameters") ?? ""),
      sourceNote: String(formData.get("source_note") ?? "").trim() || null,
    });
    revalidatePath(`/staff/payroll/tax-years/${taxYearId}`);
  });
}

export async function publishTaxYearAction(taxYearId: string): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.tax_tables.write");
    await publishTaxYear(createAdminClient(), staffActor(ctx), id.parse(taxYearId));
    revalidatePath(`/staff/payroll/tax-years/${taxYearId}`);
    revalidatePath("/staff/payroll/tax-years");
  });
}

export async function retireTaxYearAction(taxYearId: string): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("hr.tax_tables.write");
    await retireTaxYear(createAdminClient(), staffActor(ctx), id.parse(taxYearId));
    revalidatePath("/staff/payroll/tax-years");
  });
}
