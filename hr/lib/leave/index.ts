import "server-only";
import { z } from "zod";
import type { AdminClient } from "@/lib/supabase/admin";
import { audit, type Actor } from "@/lib/audit";
import { HrError } from "@/lib/errors";
import { formatDateLong } from "@/lib/format-date";
import { enqueue } from "@/lib/jobs/queue";
import type { HandlerOutcome } from "@/lib/jobs/handlers";
import { sendTemplate } from "@/lib/email/send";
import { overlaps } from "@/lib/leave/balance";

/**
 * Leave requests, recorded by HR for an employee (staff ask their manager or
 * HR in person or by email; the system keeps the record and the balance).
 * Approving or declining emails the employee when they have an address.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");

export const LeaveRequestSchema = z
  .object({
    employee_id: z.string().uuid(),
    leave_type_code: z.string().regex(/^[a-z][a-z0-9_]*$/),
    starts_on: isoDate,
    ends_on: isoDate,
    days: z.coerce.number().min(0.5, "Enter at least half a day.").max(366),
    reason: z.string().trim().max(1000).optional().transform((v) => v || null),
    approve_now: z.literal("on").optional(),
  })
  .refine((v) => v.ends_on >= v.starts_on, { message: "The last day must be on or after the first day.", path: ["ends_on"] });

export async function recordLeave(admin: AdminClient, actor: Actor, input: z.infer<typeof LeaveRequestSchema>, opts: { canApprove: boolean }): Promise<string> {
  const { data: existing } = await admin
    .from("hr_leave_requests")
    .select("starts_on, ends_on, status")
    .eq("employee_id", input.employee_id)
    .lte("starts_on", input.ends_on)
    .gte("ends_on", input.starts_on);
  if ((existing ?? []).some((r) => overlaps(input, r))) throw new HrError("This person already has leave recorded on some of these days.");
  const approve = !!input.approve_now && opts.canApprove;
  const { data, error } = await admin
    .from("hr_leave_requests")
    .insert({
      employee_id: input.employee_id,
      leave_type_code: input.leave_type_code,
      starts_on: input.starts_on,
      ends_on: input.ends_on,
      days: input.days,
      reason: input.reason,
      status: approve ? "approved" : "pending",
      decided_by: approve ? actor.id : null,
      decided_at: approve ? new Date().toISOString() : null,
      created_by: actor.id,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not record the leave");
  await audit(admin, actor, { action: approve ? "leave_recorded_approved" : "leave_requested", entityType: "hr_leave_request", entityId: data.id, employeeId: input.employee_id, after: { ...input, approve_now: approve } });
  return data.id;
}

export async function decideLeave(
  admin: AdminClient,
  actor: Actor,
  input: { requestId: string; decision: "approved" | "declined" | "cancelled"; note: string | null; notify: boolean }
): Promise<void> {
  const { data: req } = await admin.from("hr_leave_requests").select("*").eq("id", input.requestId).single();
  if (!req) throw new HrError("Leave request not found.");
  const allowed = input.decision === "cancelled" ? ["pending", "approved"] : ["pending"];
  if (!allowed.includes(req.status)) throw new HrError(`This request is already ${req.status}.`);
  const { data: updated, error } = await admin
    .from("hr_leave_requests")
    .update({ status: input.decision, decided_by: actor.id, decided_at: new Date().toISOString(), decision_note: input.note })
    .eq("id", req.id)
    .eq("status", req.status)
    .select("id");
  if (error) throw new Error(error.message);
  if (!updated?.length) throw new HrError("This request changed since you opened it. Reload the page.");
  await audit(admin, actor, { action: `leave_${input.decision}`, entityType: "hr_leave_request", entityId: req.id, employeeId: req.employee_id, before: { status: req.status }, after: { status: input.decision, note: input.note } });
  if (input.notify && input.decision !== "cancelled") {
    await enqueue(admin, [{ type: "leave_decision_email", key: `leave_decision:${req.id}:${input.decision}`, payload: { leave_request_id: req.id } }]);
  }
}

const DECISION_WORD = { approved: "approved", declined: "not approved" } as const;

export async function sendLeaveDecisionEmail(admin: AdminClient, requestId: string, idempotencyKey: string): Promise<HandlerOutcome> {
  const { data: req } = await admin.from("hr_leave_requests").select("*").eq("id", requestId).maybeSingle();
  if (!req || (req.status !== "approved" && req.status !== "declined")) return { status: "skipped", reason: "request is not decided" };
  const [{ data: employee }, { data: type }] = await Promise.all([
    admin.from("hr_employees").select("id, first_name, email").eq("id", req.employee_id).single(),
    admin.from("hr_leave_types").select("name").eq("code", req.leave_type_code).single(),
  ]);
  if (!employee?.email) return { status: "skipped", reason: "no email address" };
  const sent = await sendTemplate(admin, {
    key: "hr_leave_decision",
    to: employee.email,
    vars: {
      employee_first_name: employee.first_name,
      leave_type: (type?.name ?? "leave").toLowerCase(),
      starts_on: formatDateLong(req.starts_on),
      ends_on: formatDateLong(req.ends_on),
      days: String(req.days),
      decision: DECISION_WORD[req.status],
      note: req.decision_note,
    },
    employeeId: employee.id,
    idempotencyKey,
  });
  if (!sent.ok) throw new Error(sent.error);
  return { status: "done" };
}

export async function setEntitlement(admin: AdminClient, actor: Actor, input: { employeeId: string; code: string; year: number; days: number | null; note: string | null }): Promise<void> {
  if (input.days === null) {
    const { error } = await admin.from("hr_leave_entitlements").delete().eq("employee_id", input.employeeId).eq("leave_type_code", input.code).eq("year", input.year);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await admin
      .from("hr_leave_entitlements")
      .upsert({ employee_id: input.employeeId, leave_type_code: input.code, year: input.year, days: input.days, note: input.note }, { onConflict: "employee_id,leave_type_code,year" });
    if (error) throw new Error(error.message);
  }
  await audit(admin, actor, { action: "leave_entitlement_set", entityType: "hr_employee", entityId: input.employeeId, employeeId: input.employeeId, after: input });
}
