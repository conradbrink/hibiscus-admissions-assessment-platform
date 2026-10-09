import "server-only";
import { z } from "zod";
import type { AdminClient } from "@/lib/supabase/admin";
import { audit, type Actor } from "@/lib/audit";
import { HrError } from "@/lib/errors";
import { parseMoneyToMinor } from "@/lib/money";

/**
 * What an employee is paid. A pay change is a new row from the date it
 * applies, so re-running an old month pays what was due then. Every change
 * is audited as compensation, which only payroll people can read.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");
const money = z.string().transform((v, ctx) => {
  const m = parseMoneyToMinor(v || "0");
  if (m === null || m < 0) {
    ctx.addIssue({ code: "custom", message: "Enter an amount, like 12500 or 12,500.00." });
    return z.NEVER;
  }
  return m;
});

export const CompensationSchema = z.object({
  effective_from: isoDate,
  pay_basis: z.enum(["monthly", "hourly"]),
  basic_monthly: money,
  hourly_rate: money,
  normal_hours_per_month: z.coerce.number().min(1).max(400).default(173.33),
  tax_residency: z.enum(["resident", "non_resident"]),
  medical_aid_members: z.coerce.number().int().min(0).max(20).default(0),
  notes: z.string().trim().max(500).optional().transform((v) => v || null),
});

export const PayItemSchema = z.object({
  item_code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  amount: money,
  effective_from: isoDate,
  effective_to: isoDate.optional().or(z.literal("")).transform((v) => v || null),
});

export const BankSchema = z.object({
  bank_name: z.string().trim().min(2, "Enter the bank.").max(100),
  branch_code: z.string().trim().max(20).optional().transform((v) => v || null),
  account_name: z.string().trim().min(2, "Enter the name on the account.").max(200),
  account_number: z.string().trim().regex(/^[0-9 -]{5,30}$/, "Enter the account number, digits only.").transform((v) => v.replace(/[ -]/g, "")),
});

export async function setCompensation(admin: AdminClient, actor: Actor, employeeId: string, currency: "BWP" | "ZAR", input: z.infer<typeof CompensationSchema>): Promise<void> {
  if (input.pay_basis === "monthly" && input.basic_monthly <= 0) throw new HrError("Enter the monthly salary.");
  if (input.pay_basis === "hourly" && input.hourly_rate <= 0) throw new HrError("Enter the hourly rate.");
  const row = {
    employee_id: employeeId,
    effective_from: input.effective_from,
    pay_basis: input.pay_basis,
    basic_monthly_minor: input.pay_basis === "monthly" ? input.basic_monthly : 0,
    hourly_rate_minor: input.pay_basis === "hourly" ? input.hourly_rate : 0,
    normal_hours_per_month: input.normal_hours_per_month,
    currency,
    tax_residency: input.tax_residency,
    medical_aid_members: input.medical_aid_members,
    notes: input.notes,
    created_by: actor.id,
  };
  const { error } = await admin.from("hr_employee_compensation").upsert(row, { onConflict: "employee_id,effective_from" });
  if (error) throw new Error(error.message);
  await audit(admin, actor, { action: "compensation_set", entityType: "hr_employee", entityId: employeeId, employeeId, sensitivity: "compensation", after: row });
}

export async function addPayItem(admin: AdminClient, actor: Actor, employeeId: string, input: z.infer<typeof PayItemSchema>): Promise<void> {
  if (input.effective_to && input.effective_to < input.effective_from) throw new HrError("The end date must be after the start date.");
  if (input.amount <= 0) throw new HrError("Enter an amount.");
  const { error } = await admin.from("hr_employee_pay_items").insert({
    employee_id: employeeId,
    item_code: input.item_code,
    amount_minor: input.amount,
    effective_from: input.effective_from,
    effective_to: input.effective_to,
    created_by: actor.id,
  });
  if (error) throw new Error(error.message);
  await audit(admin, actor, { action: "pay_item_added", entityType: "hr_employee", entityId: employeeId, employeeId, sensitivity: "compensation", after: input });
}

export async function endPayItem(admin: AdminClient, actor: Actor, employeeId: string, itemId: string, endOn: string): Promise<void> {
  const { data: item } = await admin.from("hr_employee_pay_items").select("*").eq("id", itemId).eq("employee_id", employeeId).single();
  if (!item) throw new HrError("Pay item not found.");
  if (endOn < item.effective_from) throw new HrError("The end date must be on or after the start date.");
  const { error } = await admin.from("hr_employee_pay_items").update({ effective_to: endOn }).eq("id", itemId);
  if (error) throw new Error(error.message);
  await audit(admin, actor, { action: "pay_item_ended", entityType: "hr_employee", entityId: employeeId, employeeId, sensitivity: "compensation", after: { item: item.item_code, effective_to: endOn } });
}

export async function saveBank(admin: AdminClient, actor: Actor, employeeId: string, input: z.infer<typeof BankSchema>): Promise<void> {
  const { error } = await admin
    .from("hr_employee_bank")
    .upsert({ employee_id: employeeId, ...input, verified_by: null, verified_at: null }, { onConflict: "employee_id" });
  if (error) throw new Error(error.message);
  // The account number stays out of the log: the last four digits are enough to trace a change.
  await audit(admin, actor, {
    action: "bank_details_changed",
    entityType: "hr_employee",
    entityId: employeeId,
    employeeId,
    sensitivity: "compensation",
    after: { bank_name: input.bank_name, account_last4: input.account_number.slice(-4) },
  });
}

/** A second person confirms the bank details, which guards against a changed account number going unnoticed. */
export async function verifyBank(admin: AdminClient, actor: Actor, employeeId: string): Promise<void> {
  const { data } = await admin.from("hr_employee_bank").select("employee_id").eq("employee_id", employeeId).single();
  if (!data) throw new HrError("There are no bank details to confirm.");
  const { data: last } = await admin
    .from("hr_audit_log")
    .select("actor_id")
    .eq("hr_employee_id", employeeId)
    .eq("action", "bank_details_changed")
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last?.actor_id === actor.id) throw new HrError("You entered these details, so someone else must confirm them.");
  const { error } = await admin.from("hr_employee_bank").update({ verified_by: actor.id, verified_at: new Date().toISOString() }).eq("employee_id", employeeId);
  if (error) throw new Error(error.message);
  await audit(admin, actor, { action: "bank_details_verified", entityType: "hr_employee", entityId: employeeId, employeeId, sensitivity: "compensation" });
}
