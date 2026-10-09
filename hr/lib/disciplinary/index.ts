import "server-only";
import { z } from "zod";
import type { AdminClient } from "@/lib/supabase/admin";
import type { CaseOutcome, CaseStatus, WarningLevel } from "@/lib/supabase/types";
import { audit, type Actor } from "@/lib/audit";
import { HrError } from "@/lib/errors";

/**
 * Disciplinary cases. A case has a record of what happened, in order:
 * notes, evidence, the hearing, the outcome, an appeal. Entries are never
 * edited or deleted (a correction is a new note), because the record may be
 * read by the CCMA or the Industrial Court one day.
 *
 * The outcome can issue a warning, which runs for a set time and then stops
 * counting. Warnings are not deleted when they expire; they show as expired.
 */

export const CATEGORY_LABEL = {
  misconduct: "Misconduct",
  poor_performance: "Poor performance",
  absence: "Absence or lateness",
  safeguarding: "Safeguarding",
  grievance: "Grievance",
  other: "Other",
} as const;

export const STATUS_LABEL: Record<CaseStatus, string> = {
  open: "Open",
  hearing_scheduled: "Hearing booked",
  outcome_given: "Outcome given",
  appealed: "Appealed",
  closed: "Closed",
};

export const OUTCOME_LABEL: Record<CaseOutcome, string> = {
  no_action: "No action",
  verbal_warning: "Verbal warning",
  written_warning: "Written warning",
  final_written_warning: "Final written warning",
  dismissal: "Dismissal",
  other: "Other",
};

export const WARNING_LABEL: Record<WarningLevel, string> = { verbal: "Verbal warning", written: "Written warning", final_written: "Final written warning" };

/** How long each warning counts for, by default. HR can change the date. */
export const WARNING_MONTHS: Record<WarningLevel, number> = { verbal: 6, written: 6, final_written: 12 };

const OUTCOME_WARNING: Partial<Record<CaseOutcome, WarningLevel>> = {
  verbal_warning: "verbal",
  written_warning: "written",
  final_written_warning: "final_written",
};

export function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export const OpenCaseSchema = z.object({
  employee_id: z.string().uuid(),
  category: z.enum(["misconduct", "poor_performance", "absence", "safeguarding", "grievance", "other"]),
  summary: z.string().trim().min(3, "Say in a few words what this is about.").max(300),
  details: z.string().trim().max(5000).optional().transform((v) => v || null),
});

export const EventSchema = z.object({
  kind: z.enum(["note", "evidence", "hearing_scheduled", "hearing_held", "appeal"]),
  body: z.string().trim().min(2, "Write what happened.").max(5000),
  occurs_at: z.string().optional().transform((v) => (v ? new Date(v).toISOString() : null)),
});

export const OutcomeSchema = z.object({
  outcome: z.enum(["no_action", "verbal_warning", "written_warning", "final_written_warning", "dismissal", "other"]),
  outcome_note: z.string().trim().min(3, "Write the reason for the outcome.").max(5000),
  issued_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).transform((v) => v || null),
});

async function caseRow(admin: AdminClient, caseId: string) {
  const { data } = await admin.from("hr_disciplinary_cases").select("*").eq("id", caseId).single();
  if (!data) throw new HrError("Case not found.");
  return data;
}

async function addEventRow(admin: AdminClient, actor: Actor, caseId: string, kind: "note" | "evidence" | "hearing_scheduled" | "hearing_held" | "outcome" | "appeal" | "closed", body: string, occursAt: string | null = null) {
  const { error } = await admin.from("hr_case_events").insert({ case_id: caseId, kind, body, occurs_at: occursAt, created_by: actor.id });
  if (error) throw new Error(error.message);
}

export async function openCase(admin: AdminClient, actor: Actor, input: z.infer<typeof OpenCaseSchema>): Promise<string> {
  const { data, error } = await admin
    .from("hr_disciplinary_cases")
    .insert({ ...input, opened_by: actor.id })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not open the case");
  await addEventRow(admin, actor, data.id, "note", `Case opened: ${input.summary}`);
  await audit(admin, actor, { action: "case_opened", entityType: "hr_disciplinary_case", entityId: data.id, employeeId: input.employee_id, sensitivity: "compliance", after: { category: input.category } });
  return data.id;
}

export async function addCaseEvent(admin: AdminClient, actor: Actor, caseId: string, input: z.infer<typeof EventSchema>): Promise<void> {
  const c = await caseRow(admin, caseId);
  if (c.status === "closed" && input.kind !== "note") throw new HrError("This case is closed. Only notes can be added.");
  await addEventRow(admin, actor, caseId, input.kind, input.body, input.occurs_at);
  const nextStatus: Partial<Record<typeof input.kind, CaseStatus>> = { hearing_scheduled: "hearing_scheduled", appeal: "appealed" };
  const status = nextStatus[input.kind];
  if (status && c.status !== "closed") {
    const { error } = await admin.from("hr_disciplinary_cases").update({ status }).eq("id", caseId);
    if (error) throw new Error(error.message);
  }
  await audit(admin, actor, { action: `case_${input.kind}`, entityType: "hr_disciplinary_case", entityId: caseId, employeeId: c.employee_id, sensitivity: "compliance" });
}

export async function recordOutcome(admin: AdminClient, actor: Actor, caseId: string, input: z.infer<typeof OutcomeSchema>): Promise<void> {
  const c = await caseRow(admin, caseId);
  if (c.status === "closed") throw new HrError("This case is closed.");
  const level = OUTCOME_WARNING[input.outcome];
  const expires = level ? input.expires_on ?? addMonths(input.issued_on, WARNING_MONTHS[level]) : null;
  if (level && expires! <= input.issued_on) throw new HrError("The warning must end after the day it is given.");

  const { error } = await admin.from("hr_disciplinary_cases").update({ status: "outcome_given", outcome: input.outcome, outcome_note: input.outcome_note }).eq("id", caseId);
  if (error) throw new Error(error.message);
  await addEventRow(admin, actor, caseId, "outcome", `${OUTCOME_LABEL[input.outcome]}. ${input.outcome_note}`);
  if (level) {
    const { error: wError } = await admin.from("hr_warnings").insert({
      employee_id: c.employee_id,
      case_id: caseId,
      level,
      issued_on: input.issued_on,
      expires_on: expires!,
      reason: c.summary,
      created_by: actor.id,
    });
    if (wError) throw new Error(wError.message);
  }
  await audit(admin, actor, { action: "case_outcome", entityType: "hr_disciplinary_case", entityId: caseId, employeeId: c.employee_id, sensitivity: "compliance", after: { outcome: input.outcome, warning_until: expires } });
}

export async function closeCase(admin: AdminClient, actor: Actor, caseId: string, note: string): Promise<void> {
  const c = await caseRow(admin, caseId);
  if (c.status === "closed") return;
  const { error } = await admin.from("hr_disciplinary_cases").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", caseId);
  if (error) throw new Error(error.message);
  await addEventRow(admin, actor, caseId, "closed", note || "Case closed.");
  await audit(admin, actor, { action: "case_closed", entityType: "hr_disciplinary_case", entityId: caseId, employeeId: c.employee_id, sensitivity: "compliance" });
}

export async function acknowledgeWarning(admin: AdminClient, actor: Actor, warningId: string): Promise<void> {
  const { data: w } = await admin.from("hr_warnings").select("id, employee_id, acknowledged_at").eq("id", warningId).single();
  if (!w) throw new HrError("Warning not found.");
  if (w.acknowledged_at) return;
  const { error } = await admin.from("hr_warnings").update({ acknowledged_at: new Date().toISOString() }).eq("id", warningId);
  if (error) throw new Error(error.message);
  await audit(admin, actor, { action: "warning_acknowledged", entityType: "hr_warning", entityId: warningId, employeeId: w.employee_id, sensitivity: "compliance" });
}

export function isActiveWarning(w: { expires_on: string }, todayIso: string): boolean {
  return w.expires_on >= todayIso;
}
