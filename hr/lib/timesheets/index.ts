import "server-only";
import { z } from "zod";
import type { AdminClient } from "@/lib/supabase/admin";
import { audit, type Actor } from "@/lib/audit";
import { HrError } from "@/lib/errors";
import { isPeriod } from "@/lib/payroll/period";

/**
 * Timesheets: one sheet per campus and month, one row per employee. Most
 * staff are paid a monthly salary and need a row only for overtime, Sunday
 * or public holiday work, or unpaid days; hourly staff need their hours.
 *
 * A sheet is open until someone approves it. Payroll can run on an open
 * sheet (the run says so), and a sheet cannot be reopened once that month's
 * payroll is approved.
 */

const hours = z.coerce.number().min(0, "Hours cannot be below zero.").max(744);
const days = z.coerce.number().min(0).max(31);

export const EntrySchema = z.object({
  employee_id: z.string().uuid(),
  days_worked: days,
  normal_hours: hours,
  overtime_hours: hours,
  sunday_hours: hours,
  public_holiday_hours: hours,
  unpaid_days: days,
  notes: z.string().trim().max(500).optional().transform((v) => v || null),
});

export type EntryInput = z.infer<typeof EntrySchema>;

/** Reads the grid's fields, named `<field>:<employee id>`, into one entry per employee. */
export function entriesFromForm(formData: FormData): EntryInput[] {
  const byEmployee = new Map<string, Record<string, string>>();
  for (const [name, value] of formData.entries()) {
    const m = /^(days_worked|normal_hours|overtime_hours|sunday_hours|public_holiday_hours|unpaid_days|notes):([0-9a-f-]{36})$/.exec(name);
    if (!m) continue;
    const row = byEmployee.get(m[2]) ?? {};
    row[m[1]] = String(value).trim();
    byEmployee.set(m[2], row);
  }
  return [...byEmployee.entries()].map(([employee_id, r]) =>
    EntrySchema.parse({
      employee_id,
      days_worked: r.days_worked || 0,
      normal_hours: r.normal_hours || 0,
      overtime_hours: r.overtime_hours || 0,
      sunday_hours: r.sunday_hours || 0,
      public_holiday_hours: r.public_holiday_hours || 0,
      unpaid_days: r.unpaid_days || 0,
      notes: r.notes,
    })
  );
}

export async function ensurePeriod(admin: AdminClient, campusId: string, period: string): Promise<{ id: string; status: "open" | "approved" }> {
  if (!isPeriod(period)) throw new HrError("Choose a month.");
  const { data: existing } = await admin.from("hr_timesheet_periods").select("id, status").eq("campus_id", campusId).eq("period", period).maybeSingle();
  if (existing) return existing;
  const { data, error } = await admin.from("hr_timesheet_periods").insert({ campus_id: campusId, period }).select("id, status").single();
  if (error?.code === "23505") return ensurePeriod(admin, campusId, period);
  if (error || !data) throw new Error(error?.message ?? "Could not start the timesheet");
  return data;
}

export async function saveEntries(admin: AdminClient, actor: Actor, input: { campusId: string; period: string; entries: EntryInput[] }): Promise<number> {
  const sheet = await ensurePeriod(admin, input.campusId, input.period);
  if (sheet.status === "approved") throw new HrError("This timesheet is approved. Reopen it to make changes.");
  const ids = input.entries.map((e) => e.employee_id);
  if (!ids.length) return 0;
  const { data: employees } = await admin.from("hr_employees").select("id").eq("campus_id", input.campusId).in("id", ids);
  const allowed = new Set((employees ?? []).map((e) => e.id));
  const rows = input.entries
    .filter((e) => allowed.has(e.employee_id))
    .map((e) => ({ ...e, period_id: sheet.id, updated_by: actor.id, updated_at: new Date().toISOString() }));
  const { error } = await admin.from("hr_timesheet_entries").upsert(rows, { onConflict: "period_id,employee_id" });
  if (error) throw new Error(error.message);
  await audit(admin, actor, { action: "timesheet_saved", entityType: "hr_timesheet_period", entityId: sheet.id, campusId: input.campusId, after: { period: input.period, rows: rows.length } });
  return rows.length;
}

export async function approveSheet(admin: AdminClient, actor: Actor, campusId: string, period: string): Promise<void> {
  const sheet = await ensurePeriod(admin, campusId, period);
  if (sheet.status === "approved") return;
  const { error } = await admin.from("hr_timesheet_periods").update({ status: "approved", approved_by: actor.id, approved_at: new Date().toISOString() }).eq("id", sheet.id);
  if (error) throw new Error(error.message);
  await audit(admin, actor, { action: "timesheet_approved", entityType: "hr_timesheet_period", entityId: sheet.id, campusId, after: { period } });
}

export async function reopenSheet(admin: AdminClient, actor: Actor, campusId: string, period: string): Promise<void> {
  const { data: run } = await admin.from("hr_payroll_runs").select("status").eq("campus_id", campusId).eq("period", period).maybeSingle();
  if (run && (run.status === "approved" || run.status === "locked")) {
    throw new HrError("This month's payroll is approved, so the timesheet cannot change. Put any correction in next month's sheet.");
  }
  const { error } = await admin.from("hr_timesheet_periods").update({ status: "open", approved_by: null, approved_at: null }).eq("campus_id", campusId).eq("period", period);
  if (error) throw new Error(error.message);
  await audit(admin, actor, { action: "timesheet_reopened", entityType: "hr_timesheet_period", campusId, after: { period } });
}
