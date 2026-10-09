import "server-only";
import { z } from "zod";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";
import { audit, type Actor } from "@/lib/audit";
import { HrError } from "@/lib/errors";

/**
 * Employee records: the person, their contract, their private details and
 * documents. Writes go through here under the service role after the action
 * has checked the permission and read the employee through the person's own
 * client; every change is audited.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date.");
const optionalDate = isoDate.optional().or(z.literal("")).transform((v) => v || null);
const optionalText = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

export const EmployeeSchema = z.object({
  campus_id: z.string().uuid(),
  first_name: z.string().trim().min(1, "Enter a first name.").max(100),
  last_name: z.string().trim().min(1, "Enter a last name.").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email.").max(200).optional().or(z.literal("")).transform((v) => v || null),
  phone: optionalText(30),
  position_title: z.string().trim().min(2, "Enter the position.").max(200),
  department_id: z.string().uuid().optional().or(z.literal("")).transform((v) => v || null),
  is_teaching: z.boolean(),
  employment_type: z.enum(["permanent", "fixed_term", "part_time", "temporary"]),
  start_date: isoDate,
  probation_end_date: optionalDate,
});

export type EmployeeInput = z.infer<typeof EmployeeSchema>;

export const PrivateSchema = z.object({
  id_number: optionalText(60),
  passport_number: optionalText(60),
  date_of_birth: optionalDate,
  nationality: optionalText(80),
  address: optionalText(500),
  next_of_kin_name: optionalText(200),
  next_of_kin_phone: optionalText(30),
  tax_number: optionalText(40),
  registration_body: z.enum(["SACE", "BTPC", "other", "none"]).optional().or(z.literal("")).transform((v) => v || null),
  registration_number: optionalText(60),
  registration_expires_on: optionalDate,
  permit_type: optionalText(80),
  permit_expires_on: optionalDate,
  police_clearance_on: optionalDate,
});

export const ContractSchema = z.object({
  contract_type: z.enum(["permanent", "fixed_term", "part_time", "temporary"]),
  starts_on: isoDate,
  ends_on: optionalDate,
  probation_months: z.coerce.number().int().min(0).max(12).optional(),
  hours_per_week: z.coerce.number().min(0).max(80).optional(),
  notice_weeks: z.coerce.number().int().min(0).max(26).optional(),
  notes: optionalText(2000),
});

export const StatusSchema = z.object({
  employment_status: z.enum(["active", "on_leave", "suspended", "terminated"]),
  end_date: optionalDate,
  termination_reason: optionalText(500),
});

export async function createEmployee(admin: AdminClient, actor: Actor, input: EmployeeInput, extra: { hrApplicationId?: string } = {}): Promise<string> {
  const { data, error } = await admin
    .from("hr_employees")
    .insert({ ...input, employee_number: "", hr_application_id: extra.hrApplicationId ?? null, created_by: actor.id })
    .select("id")
    .single();
  if (error || !data) {
    if (error?.code === "23505") throw new HrError("This applicant already has an employee record.");
    throw new Error(error?.message ?? "Could not create the employee");
  }
  await audit(admin, actor, { action: "employee_created", entityType: "hr_employee", entityId: data.id, employeeId: data.id, campusId: input.campus_id, after: input as unknown as Json });
  return data.id;
}

export async function updateEmployee(admin: AdminClient, actor: Actor, id: string, input: EmployeeInput): Promise<void> {
  const { data: before } = await admin.from("hr_employees").select("*").eq("id", id).single();
  const { error } = await admin.from("hr_employees").update(input).eq("id", id);
  if (error) throw new Error(error.message);
  await audit(admin, actor, { action: "employee_updated", entityType: "hr_employee", entityId: id, employeeId: id, campusId: input.campus_id, before: before as unknown as Json, after: input as unknown as Json });
}

export async function setEmploymentStatus(admin: AdminClient, actor: Actor, id: string, input: z.infer<typeof StatusSchema>): Promise<void> {
  if (input.employment_status === "terminated" && !input.end_date) throw new HrError("Enter the last working day.");
  const { error } = await admin.from("hr_employees").update(input).eq("id", id);
  if (error) throw new Error(error.message);
  await audit(admin, actor, { action: "employment_status_changed", entityType: "hr_employee", entityId: id, employeeId: id, after: input as unknown as Json });
}

export async function savePrivate(admin: AdminClient, actor: Actor, employeeId: string, input: z.infer<typeof PrivateSchema>): Promise<void> {
  const { error } = await admin.from("hr_employee_private").upsert({ employee_id: employeeId, ...input }, { onConflict: "employee_id" });
  if (error) throw new Error(error.message);
  // The values are not copied into the audit row: the log is read more widely than this table.
  await audit(admin, actor, { action: "private_details_updated", entityType: "hr_employee", entityId: employeeId, employeeId, sensitivity: "compliance", after: { fields: Object.keys(input) } });
}

export async function addContract(admin: AdminClient, actor: Actor, employeeId: string, input: z.infer<typeof ContractSchema>): Promise<void> {
  const { error } = await admin.from("hr_employee_contracts").insert({ employee_id: employeeId, ...input, created_by: actor.id });
  if (error) throw new Error(error.message);
  const probationEnd =
    input.probation_months && input.probation_months > 0
      ? (() => {
          const d = new Date(`${input.starts_on}T00:00:00Z`);
          d.setUTCMonth(d.getUTCMonth() + input.probation_months);
          return d.toISOString().slice(0, 10);
        })()
      : null;
  await admin
    .from("hr_employees")
    .update({ employment_type: input.contract_type, ...(probationEnd ? { probation_end_date: probationEnd } : {}) })
    .eq("id", employeeId);
  await audit(admin, actor, { action: "contract_added", entityType: "hr_employee", entityId: employeeId, employeeId, after: input as unknown as Json });
}

/** Contracts, probations, registrations, permits and police clearances that need action soon. */
export type Expiring = { employeeId: string; name: string; what: string; on: string };

export async function expiringSoon(client: AdminClient | import("@supabase/supabase-js").SupabaseClient<import("@/lib/supabase/types").Database>, withinDays = 60): Promise<Expiring[]> {
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + withinDays * 86_400_000).toISOString().slice(0, 10);
  const [{ data: employees }, { data: privates }] = await Promise.all([
    client.from("hr_employees").select("id, first_name, last_name, probation_end_date, end_date, employment_status").neq("employment_status", "terminated"),
    client.from("hr_employee_private").select("employee_id, registration_expires_on, permit_expires_on, police_clearance_on"),
  ]);
  const name = new Map((employees ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`]));
  const out: Expiring[] = [];
  const within = (d: string | null) => !!d && d >= today && d <= until;
  for (const e of employees ?? []) {
    if (within(e.probation_end_date)) out.push({ employeeId: e.id, name: name.get(e.id)!, what: "Probation ends", on: e.probation_end_date! });
    if (within(e.end_date)) out.push({ employeeId: e.id, name: name.get(e.id)!, what: "Contract ends", on: e.end_date! });
  }
  for (const p of privates ?? []) {
    if (!name.has(p.employee_id)) continue;
    if (within(p.registration_expires_on)) out.push({ employeeId: p.employee_id, name: name.get(p.employee_id)!, what: "Teacher registration expires", on: p.registration_expires_on! });
    if (within(p.permit_expires_on)) out.push({ employeeId: p.employee_id, name: name.get(p.employee_id)!, what: "Work permit expires", on: p.permit_expires_on! });
  }
  return out.sort((a, b) => (a.on < b.on ? -1 : 1));
}
