import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { HrEmployeeRow, HrPayrollRunRow, Json } from "@/lib/supabase/types";
import { audit, type Actor } from "@/lib/audit";
import { HrError } from "@/lib/errors";
import { calculatePayslip, type PayItem, type PayslipInput, type PayslipResult } from "@/lib/payroll/calculate";
import { currencyFor, employedDuring, periodBounds, periodLabel } from "@/lib/payroll/period";
import { taxTableFor } from "@/lib/payroll/tax-years";
import { TaxTableError } from "@/lib/payroll/tax-table";

/**
 * A payroll run: one campus, one month.
 *
 *   draft → calculated → approved → locked
 *
 * Calculating (and recalculating, after an override or a corrected
 * timesheet) replaces every payslip in the run and makes the person who did
 * it the preparer. Approving needs a second person: the database refuses
 * the preparer as approver. Once approved, nothing in the run can change; a
 * mistake is corrected in the next month's run.
 */

export type RunTotals = {
  employees: number;
  grossMinor: number;
  payeMinor: number;
  uifEmployeeMinor: number;
  uifEmployerMinor: number;
  sdlMinor: number;
  deductionsMinor: number;
  netMinor: number;
  employerCostMinor: number;
  /** People in the run's campus and month who could not be paid, and why. */
  skipped: { employeeId: string; name: string; reason: string }[];
  warningCount: number;
  timesheetApproved: boolean;
};

export function readTotals(run: Pick<HrPayrollRunRow, "totals">): RunTotals | null {
  const t = run.totals as unknown as Partial<RunTotals> | null;
  return t && typeof t.employees === "number" ? (t as RunTotals) : null;
}

const RUN_ERRORS: Record<string, string> = {
  payroll_run_frozen: "This run is approved and cannot change. Correct it in next month's run.",
  payroll_run_locked: "This run is locked.",
};

function friendly(error: { message: string; code?: string }): Error {
  for (const [k, v] of Object.entries(RUN_ERRORS)) if (error.message.includes(k)) return new HrError(v);
  if (error.code === "23514" && error.message.includes("four_eyes")) {
    return new HrError("You calculated this run, so someone else must approve it.");
  }
  return new Error(error.message);
}

export async function createRun(admin: AdminClient, actor: Actor, input: { campusId: string; period: string }): Promise<string> {
  periodBounds(input.period);
  const { data: campus } = await admin.from("campuses").select("id, name, country").eq("id", input.campusId).single();
  if (!campus) throw new HrError("School not found.");
  const country = campus.country as "BW" | "ZA";
  const { data, error } = await admin
    .from("hr_payroll_runs")
    .insert({ campus_id: campus.id, period: input.period, country, currency: currencyFor(country) })
    .select("id")
    .single();
  if (error || !data) {
    if (error?.code === "23505") throw new HrError(`There is already a ${periodLabel(input.period)} run for ${campus.name}.`);
    throw new Error(error?.message ?? "Could not create the run");
  }
  await audit(admin, actor, { action: "payroll_run_created", entityType: "hr_payroll_run", entityId: data.id, campusId: campus.id, sensitivity: "compensation", after: input });
  return data.id;
}

async function loadRun(admin: AdminClient, runId: string): Promise<HrPayrollRunRow> {
  const { data } = await admin.from("hr_payroll_runs").select("*").eq("id", runId).single();
  if (!data) throw new HrError("Payroll run not found.");
  return data;
}

type Prepared = { employee: HrEmployeeRow; input: PayslipInput; snapshot: Json };

/** Everything the calculator needs, for every employee paid in the run. */
async function prepareInputs(admin: AdminClient, run: HrPayrollRunRow): Promise<{ prepared: Prepared[]; skipped: RunTotals["skipped"]; timesheetApproved: boolean }> {
  const { start, end } = periodBounds(run.period);
  const [{ data: employees }, { data: campus }] = await Promise.all([
    admin.from("hr_employees").select("*").eq("campus_id", run.campus_id).order("last_name"),
    admin.from("campuses").select("name").eq("id", run.campus_id).single(),
  ]);
  const paid = (employees ?? []).filter((e) => employedDuring(e, run.period));
  const ids = paid.map((e) => e.id);
  if (!ids.length) return { prepared: [], skipped: [], timesheetApproved: false };

  const [{ data: comps }, { data: itemRows }, { data: catalogue }, { data: privates }, { data: banks }, { data: period }, { data: overrides }] = await Promise.all([
    admin.from("hr_employee_compensation").select("*").in("employee_id", ids).lte("effective_from", end).order("effective_from", { ascending: false }),
    admin.from("hr_employee_pay_items").select("*").in("employee_id", ids).lte("effective_from", end),
    admin.from("hr_pay_items").select("*"),
    admin.from("hr_employee_private").select("employee_id, date_of_birth, tax_number").in("employee_id", ids),
    admin.from("hr_employee_bank").select("employee_id, bank_name, account_number").in("employee_id", ids),
    admin.from("hr_timesheet_periods").select("id, status").eq("campus_id", run.campus_id).eq("period", run.period).maybeSingle(),
    admin.from("hr_payslip_overrides").select("*").eq("run_id", run.id),
  ]);
  const { data: entries } = period
    ? await admin.from("hr_timesheet_entries").select("*").eq("period_id", period.id)
    : { data: [] as never[] };

  const compFor = new Map<string, NonNullable<typeof comps>[number]>();
  for (const c of comps ?? []) if (!compFor.has(c.employee_id)) compFor.set(c.employee_id, c); // newest first
  const itemDef = new Map((catalogue ?? []).map((i) => [i.code, i]));
  const privateFor = new Map((privates ?? []).map((p) => [p.employee_id, p]));
  const bankFor = new Map((banks ?? []).map((b) => [b.employee_id, b]));
  const entryFor = new Map((entries ?? []).map((t) => [t.employee_id, t]));

  const skipped: RunTotals["skipped"] = [];
  const prepared: Prepared[] = [];
  for (const e of paid) {
    const name = `${e.first_name} ${e.last_name}`;
    const comp = compFor.get(e.id);
    if (!comp) {
      skipped.push({ employeeId: e.id, name, reason: "No salary is set up." });
      continue;
    }
    if (comp.currency !== run.currency) {
      skipped.push({ employeeId: e.id, name, reason: `Paid in ${comp.currency}, but this school pays in ${run.currency}.` });
      continue;
    }
    const items: PayItem[] = [];
    for (const r of itemRows ?? []) {
      if (r.employee_id !== e.id || (r.effective_to && r.effective_to < start)) continue;
      const def = itemDef.get(r.item_code);
      if (!def || (def.country && def.country !== run.country)) continue;
      items.push({ code: def.code, label: def.label, kind: def.kind, taxable: def.taxable, preTax: def.pre_tax, amountMinor: Number(r.amount_minor) });
    }
    const ts = entryFor.get(e.id);
    const priv = privateFor.get(e.id);
    const bank = bankFor.get(e.id);
    const ov: Record<string, number> = {};
    for (const o of overrides ?? []) if (o.employee_id === e.id) ov[o.code] = Number(o.amount_minor);
    prepared.push({
      employee: e,
      input: {
        country: run.country,
        periodStart: start,
        periodEnd: end,
        employee: {
          startDate: e.start_date,
          endDate: e.end_date,
          dateOfBirth: priv?.date_of_birth ?? null,
          residency: comp.tax_residency,
          medicalMembers: comp.medical_aid_members,
          hasTaxNumber: !!priv?.tax_number,
        },
        compensation: {
          basis: comp.pay_basis,
          basicMonthlyMinor: Number(comp.basic_monthly_minor),
          hourlyRateMinor: Number(comp.hourly_rate_minor),
          normalHoursPerMonth: Number(comp.normal_hours_per_month),
        },
        items,
        timesheet: ts
          ? {
              normalHours: Number(ts.normal_hours),
              overtimeHours: Number(ts.overtime_hours),
              sundayHours: Number(ts.sunday_hours),
              publicHolidayHours: Number(ts.public_holiday_hours),
              unpaidDays: Number(ts.unpaid_days),
            }
          : null,
        sdlApplies: false,
        overrides: ov,
      },
      // What the payslip says about the person, frozen with it.
      snapshot: {
        employee_number: e.employee_number,
        name,
        position: e.position_title,
        campus: campus?.name ?? null,
        start_date: e.start_date,
        tax_number: priv?.tax_number ?? null,
        bank_name: bank?.bank_name ?? null,
        account_last4: bank?.account_number ? bank.account_number.slice(-4) : null,
        email: e.email,
      },
    });
  }
  return { prepared, skipped, timesheetApproved: period?.status === "approved" };
}

export async function calculateRun(admin: AdminClient, actor: Actor, runId: string): Promise<RunTotals> {
  const run = await loadRun(admin, runId);
  if (run.status !== "draft" && run.status !== "calculated") throw new HrError(RUN_ERRORS.payroll_run_frozen);
  const { end } = periodBounds(run.period);
  const { id: taxYearId, table } = await taxTableFor(admin, run.country, end);
  const { prepared, skipped, timesheetApproved } = await prepareInputs(admin, run);

  let results: PayslipResult[];
  try {
    results = prepared.map((p) => calculatePayslip(p.input, table));
    // South Africa: SDL is due when the employer's yearly payroll is above the
    // threshold. This month's gross, times twelve, is the estimate.
    if (table.country === "ZA") {
      const annualGross = results.reduce((s, r) => s + r.grossMinor, 0) * 12;
      if (annualGross > table.params.sdl.annualPayrollThresholdMinor) {
        for (const p of prepared) p.input = { ...p.input, sdlApplies: true };
        results = prepared.map((p) => calculatePayslip(p.input, table));
      }
    }
  } catch (e) {
    if (e instanceof TaxTableError) throw new HrError(e.message);
    throw e;
  }

  // Replace the run's payslips. Lines go with them (on delete cascade).
  const { error: delError } = await admin.from("hr_payslips").delete().eq("run_id", run.id);
  if (delError) throw friendly(delError);

  if (prepared.length) {
    const { data: slips, error: slipError } = await admin
      .from("hr_payslips")
      .insert(
        prepared.map((p, i) => {
          const r = results[i];
          return {
            run_id: run.id,
            employee_id: p.employee.id,
            employee_snapshot: p.snapshot,
            gross_minor: r.grossMinor,
            taxable_minor: r.taxableMinor,
            paye_minor: r.payeMinor,
            uif_employee_minor: r.uifEmployeeMinor,
            uif_employer_minor: r.uifEmployerMinor,
            sdl_minor: r.sdlMinor,
            deductions_minor: r.deductionsMinor,
            net_minor: r.netMinor,
            employer_cost_minor: r.employerCostMinor,
            calc_version: r.calcVersion,
            inputs: { ...p.input, taxTable: table.code } as unknown as Json,
            warnings: r.warnings,
          };
        })
      )
      .select("id, employee_id");
    if (slipError || !slips) throw friendly(slipError ?? { message: "Could not save payslips" });
    const slipFor = new Map(slips.map((s) => [s.employee_id, s.id]));
    const { data: overrides } = await admin.from("hr_payslip_overrides").select("*").eq("run_id", run.id);
    const overrideFor = new Map((overrides ?? []).map((o) => [`${o.employee_id}:${o.code}`, o]));
    const lines = prepared.flatMap((p, i) =>
      results[i].lines.map((l, order) => {
        const o = l.overridden ? overrideFor.get(`${p.employee.id}:${l.code}`) : undefined;
        return {
          payslip_id: slipFor.get(p.employee.id)!,
          code: l.code,
          label: l.label,
          kind: l.kind,
          computed_minor: l.computedMinor,
          effective_minor: l.effectiveMinor,
          override_reason: o?.reason ?? null,
          overridden_by: o?.created_by ?? null,
          sort_order: order,
        };
      })
    );
    if (lines.length) {
      const { error: lineError } = await admin.from("hr_payslip_lines").insert(lines);
      if (lineError) throw friendly(lineError);
    }
  }

  const sum = (f: (r: PayslipResult) => number) => results.reduce((s, r) => s + f(r), 0);
  const totals: RunTotals = {
    employees: results.length,
    grossMinor: sum((r) => r.grossMinor),
    payeMinor: sum((r) => r.payeMinor),
    uifEmployeeMinor: sum((r) => r.uifEmployeeMinor),
    uifEmployerMinor: sum((r) => r.uifEmployerMinor),
    sdlMinor: sum((r) => r.sdlMinor),
    deductionsMinor: sum((r) => r.deductionsMinor),
    netMinor: sum((r) => r.netMinor),
    employerCostMinor: sum((r) => r.employerCostMinor),
    skipped,
    warningCount: sum((r) => r.warnings.length),
    timesheetApproved,
  };
  const { error: runError } = await admin
    .from("hr_payroll_runs")
    .update({ status: "calculated", tax_year_id: taxYearId, totals: totals as unknown as Json, prepared_by: actor.id, prepared_at: new Date().toISOString() })
    .eq("id", run.id)
    .in("status", ["draft", "calculated"]);
  if (runError) throw friendly(runError);
  await audit(admin, actor, {
    action: "payroll_run_calculated",
    entityType: "hr_payroll_run",
    entityId: run.id,
    campusId: run.campus_id,
    sensitivity: "compensation",
    after: { period: run.period, employees: totals.employees, netMinor: totals.netMinor, taxTable: table.code },
  });
  return totals;
}

/** Sets (or, with `amountMinor` null, removes) an override and recalculates the run. */
export async function setOverride(
  admin: AdminClient,
  actor: Actor,
  input: { runId: string; employeeId: string; code: string; amountMinor: number | null; reason: string }
): Promise<void> {
  const run = await loadRun(admin, input.runId);
  if (run.status !== "draft" && run.status !== "calculated") throw new HrError(RUN_ERRORS.payroll_run_frozen);
  const { data: before } = await admin
    .from("hr_payslip_overrides")
    .select("amount_minor, reason")
    .eq("run_id", run.id)
    .eq("employee_id", input.employeeId)
    .eq("code", input.code)
    .maybeSingle();
  if (input.amountMinor === null) {
    const { error } = await admin.from("hr_payslip_overrides").delete().eq("run_id", run.id).eq("employee_id", input.employeeId).eq("code", input.code);
    if (error) throw friendly(error);
  } else {
    if (input.reason.trim().length < 3) throw new HrError("Give a reason for the change.");
    const { error } = await admin.from("hr_payslip_overrides").upsert(
      { run_id: run.id, employee_id: input.employeeId, code: input.code, amount_minor: input.amountMinor, reason: input.reason.trim(), created_by: actor.id },
      { onConflict: "run_id,employee_id,code" }
    );
    if (error) throw friendly(error);
  }
  await audit(admin, actor, {
    action: input.amountMinor === null ? "payslip_override_removed" : "payslip_override_set",
    entityType: "hr_payroll_run",
    entityId: run.id,
    employeeId: input.employeeId,
    campusId: run.campus_id,
    sensitivity: "compensation",
    before: (before ?? null) as Json,
    after: { code: input.code, amount_minor: input.amountMinor, reason: input.reason },
  });
  await calculateRun(admin, actor, run.id);
}

export async function approveRun(admin: AdminClient, actor: Actor, runId: string): Promise<void> {
  const run = await loadRun(admin, runId);
  if (run.status !== "calculated") throw new HrError("Only a calculated run can be approved.");
  if (run.prepared_by === actor.id) throw new HrError("You calculated this run, so someone else must approve it.");
  const { data, error } = await admin
    .from("hr_payroll_runs")
    .update({ status: "approved", approved_by: actor.id, approved_at: new Date().toISOString() })
    .eq("id", run.id)
    .eq("status", "calculated")
    // Recalculated since the page was opened: the approver must see the new figures first.
    .eq("prepared_at", run.prepared_at!)
    .select("id");
  if (error) throw friendly(error);
  if (!data?.length) throw new HrError("This run changed since you opened it. Reload the page and check it again.");
  await audit(admin, actor, { action: "payroll_run_approved", entityType: "hr_payroll_run", entityId: run.id, campusId: run.campus_id, sensitivity: "compensation", after: { period: run.period } });
}

export async function lockRun(admin: AdminClient, actor: Actor, runId: string): Promise<void> {
  const run = await loadRun(admin, runId);
  if (run.status !== "approved") throw new HrError("Only an approved run can be locked.");
  const { error } = await admin
    .from("hr_payroll_runs")
    .update({ status: "locked", locked_by: actor.id, locked_at: new Date().toISOString() })
    .eq("id", run.id)
    .eq("status", "approved");
  if (error) throw friendly(error);
  await audit(admin, actor, { action: "payroll_run_locked", entityType: "hr_payroll_run", entityId: run.id, campusId: run.campus_id, sensitivity: "compensation" });
}

/** A run still in draft or calculated can be thrown away and started again. */
export async function deleteRun(admin: AdminClient, actor: Actor, runId: string): Promise<void> {
  const run = await loadRun(admin, runId);
  if (run.status !== "draft" && run.status !== "calculated") throw new HrError("An approved run cannot be deleted.");
  const { error } = await admin.from("hr_payroll_runs").delete().eq("id", run.id).in("status", ["draft", "calculated"]);
  if (error) throw friendly(error);
  await audit(admin, actor, { action: "payroll_run_deleted", entityType: "hr_payroll_run", entityId: run.id, campusId: run.campus_id, sensitivity: "compensation", after: { period: run.period } });
}
