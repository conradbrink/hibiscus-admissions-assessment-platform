import "server-only";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";
import type { AdminClient } from "@/lib/supabase/admin";
import type { HrPayrollRunRow, HrPayslipLineRow, HrPayslipRow } from "@/lib/supabase/types";
import { audit, type Actor } from "@/lib/audit";
import { logoUrlFor } from "@/lib/documents/letterhead";
import { HrError } from "@/lib/errors";
import { formatDateLong } from "@/lib/format-date";
import { enqueue } from "@/lib/jobs/queue";
import { periodLabel } from "@/lib/payroll/period";
import { PayslipDocument, type PayslipPage } from "@/lib/payroll/payslip-pdf";
import type { HandlerOutcome } from "@/lib/jobs/handlers";
import { sendTemplate } from "@/lib/email/send";
import { mintToken, siteUrl } from "@/lib/tokens";
import type { ExportSlip } from "@/lib/payroll/exports";

/**
 * Reading a run's payslips back: for the bulk PDF, a single employee's PDF,
 * the exports and the payslip emails. The reads take whichever client the
 * caller has: staff pages pass the person's own (so the strict pay policy
 * decides), the employee's link passes the service role after the cookie
 * has named exactly one payslip.
 */

type Client = Pick<AdminClient, "from">;

export type Snapshot = PayslipPage["snapshot"] & { email?: string | null; start_date?: string };

export type LoadedRun = {
  run: HrPayrollRunRow;
  campus: { name: string; descriptor: string | null; address: string | null };
  taxTableCode: string | null;
  slips: Array<HrPayslipRow & { snapshot: Snapshot; lines: HrPayslipLineRow[] }>;
};

export async function loadRunPayslips(client: Client, runId: string, opts: { payslipId?: string; employeeIds?: string[] } = {}): Promise<LoadedRun | null> {
  const { data: run } = await client.from("hr_payroll_runs").select("*").eq("id", runId).maybeSingle();
  if (!run) return null;
  let q = client.from("hr_payslips").select("*").eq("run_id", runId);
  if (opts.payslipId) q = q.eq("id", opts.payslipId);
  if (opts.employeeIds?.length) q = q.in("employee_id", opts.employeeIds);
  const [{ data: campus }, { data: slips }, { data: year }] = await Promise.all([
    client.from("campuses").select("name, descriptor, address").eq("id", run.campus_id).single(),
    q,
    run.tax_year_id ? client.from("hr_tax_years").select("code").eq("id", run.tax_year_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const ids = (slips ?? []).map((s) => s.id);
  const { data: lines } = ids.length ? await client.from("hr_payslip_lines").select("*").in("payslip_id", ids).order("sort_order") : { data: [] as HrPayslipLineRow[] };
  const linesFor = new Map<string, HrPayslipLineRow[]>();
  for (const l of lines ?? []) linesFor.set(l.payslip_id, [...(linesFor.get(l.payslip_id) ?? []), l]);
  return {
    run,
    campus: campus ?? { name: "", descriptor: null, address: null },
    taxTableCode: year?.code ?? null,
    slips: (slips ?? [])
      .map((s) => ({ ...s, snapshot: s.employee_snapshot as unknown as Snapshot, lines: linesFor.get(s.id) ?? [] }))
      .sort((a, b) => a.snapshot.name.localeCompare(b.snapshot.name)),
  };
}

export async function renderPayslipsPdf(loaded: LoadedRun): Promise<Buffer> {
  const element = createElement(PayslipDocument, {
    logoUrl: logoUrlFor(siteUrl()),
    letterhead: loaded.campus,
    periodLabel: periodLabel(loaded.run.period),
    payDate: loaded.run.approved_at ? formatDateLong(loaded.run.approved_at) : null,
    currency: loaded.run.currency,
    taxTableCode: loaded.taxTableCode,
    status: loaded.run.status,
    payslips: loaded.slips.map((s) => ({
      snapshot: s.snapshot,
      lines: s.lines.map((l) => ({ code: l.code, label: l.label, kind: l.kind, effective_minor: Number(l.effective_minor), overridden: l.override_reason !== null })),
      grossMinor: Number(s.gross_minor),
      deductionsMinor: Number(s.deductions_minor),
      netMinor: Number(s.net_minor),
    })),
  }) as unknown as ReactElement<DocumentProps>;
  return renderToBuffer(element);
}

export function toExportSlips(loaded: LoadedRun): ExportSlip[] {
  return loaded.slips.map((s) => ({
    employeeNumber: s.snapshot.employee_number,
    name: s.snapshot.name,
    taxNumber: s.snapshot.tax_number,
    grossMinor: Number(s.gross_minor),
    taxableMinor: Number(s.taxable_minor),
    payeMinor: Number(s.paye_minor),
    uifEmployeeMinor: Number(s.uif_employee_minor),
    uifEmployerMinor: Number(s.uif_employer_minor),
    sdlMinor: Number(s.sdl_minor),
    netMinor: Number(s.net_minor),
    lines: s.lines.map((l) => ({ code: l.code, label: l.label, kind: l.kind, effectiveMinor: Number(l.effective_minor) })),
  }));
}

/** Queues a "your payslip is ready" email for everyone in an approved run who has an email address. */
export async function queuePayslipEmails(admin: AdminClient, actor: Actor, runId: string): Promise<{ queued: number; withoutEmail: number }> {
  const { data: run } = await admin.from("hr_payroll_runs").select("*").eq("id", runId).single();
  if (!run) throw new HrError("Payroll run not found.");
  if (run.status !== "approved" && run.status !== "locked") throw new HrError("Payslips can be emailed once the run is approved.");
  const { data: slips } = await admin.from("hr_payslips").select("id, employee_snapshot").eq("run_id", runId);
  const withEmail = (slips ?? []).filter((s) => (s.employee_snapshot as unknown as Snapshot).email);
  await enqueue(
    admin,
    withEmail.map((s) => ({ type: "payslip_send" as const, key: `payslip_send:${s.id}`, payload: { payslip_id: s.id } }))
  );
  await audit(admin, actor, {
    action: "payslip_emails_queued",
    entityType: "hr_payroll_run",
    entityId: runId,
    campusId: run.campus_id,
    sensitivity: "compensation",
    after: { queued: withEmail.length },
  });
  return { queued: withEmail.length, withoutEmail: (slips ?? []).length - withEmail.length };
}

const PAYSLIP_LINK_DAYS = 60;

/** The job: a fresh link, minted as the email leaves, so no live link waits in the queue. */
export async function sendPayslipEmail(admin: AdminClient, payslipId: string, idempotencyKey: string): Promise<HandlerOutcome> {
  const { data: slip } = await admin.from("hr_payslips").select("id, run_id, employee_id, employee_snapshot").eq("id", payslipId).maybeSingle();
  if (!slip) return { status: "skipped", reason: "payslip no longer exists" };
  const { data: run } = await admin.from("hr_payroll_runs").select("status, period").eq("id", slip.run_id).single();
  if (!run || (run.status !== "approved" && run.status !== "locked")) return { status: "skipped", reason: "run is not approved" };
  const snapshot = slip.employee_snapshot as unknown as Snapshot;
  if (!snapshot.email) return { status: "skipped", reason: "no email address" };
  const { url, expiresAt } = await mintToken(admin, { purpose: "payslip", payslipId: slip.id }, { ttlDays: PAYSLIP_LINK_DAYS, reason: "payslip email" });
  const sent = await sendTemplate(admin, {
    key: "hr_payslip_ready",
    to: snapshot.email,
    vars: {
      employee_first_name: snapshot.name.split(" ")[0],
      period: periodLabel(run.period),
      link: url,
      link_expires_on: formatDateLong(expiresAt),
    },
    employeeId: slip.employee_id,
    idempotencyKey,
  });
  if (!sent.ok) throw new Error(sent.error);
  return { status: "done" };
}
