import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { HrApplicationRow } from "@/lib/supabase/types";
import type { Actor } from "@/lib/audit";
import { HrError } from "@/lib/errors";
import { markHired } from "@/lib/recruitment/engine";
import { createEmployee } from "@/lib/employees";

/**
 * Hiring a shortlisted applicant. Marks the application hired (which also
 * takes it out of retention: a hired applicant's record is kept), then
 * creates the employee record from it, carrying over the registration,
 * permit and police clearance the applicant gave.
 *
 * If the employee record could not be created after the application was
 * marked hired, running this again for the hired application finishes the
 * job instead of refusing.
 */
export async function hireApplicant(admin: AdminClient, actor: Actor, app: HrApplicationRow, opts: { startDate: string }): Promise<string> {
  const resuming = app.status === "hired";
  if (!resuming && (app.status !== "submitted" || app.stage !== "shortlisted")) throw new HrError("Only a shortlisted applicant can be hired.");

  const { data: existing } = await admin.from("hr_employees").select("id").eq("hr_application_id", app.id).maybeSingle();
  if (existing) return existing.id;

  const [{ data: vacancy }, { data: compliance }] = await Promise.all([
    admin.from("hr_vacancies").select("title, phase, employment_type").eq("id", app.vacancy_id).single(),
    admin.from("hr_application_compliance").select("*").eq("application_id", app.id).maybeSingle(),
  ]);
  if (!vacancy) throw new Error("Vacancy missing for application");

  if (!resuming) await markHired(admin, actor, app);

  const employeeId = await createEmployee(
    admin,
    actor,
    {
      campus_id: app.campus_id,
      first_name: app.first_name,
      last_name: app.last_name,
      email: app.email,
      phone: app.phone,
      position_title: vacancy.title,
      department_id: null,
      is_teaching: vacancy.phase !== "general",
      employment_type: vacancy.employment_type as "permanent" | "fixed_term" | "part_time" | "temporary",
      start_date: opts.startDate,
      probation_end_date: null,
    },
    { hrApplicationId: app.id },
  );

  const { error } = await admin.from("hr_employee_private").insert({
    employee_id: employeeId,
    nationality: app.nationality,
    registration_body: compliance?.registration_body ?? null,
    registration_number: compliance?.registration_number ?? null,
    registration_expires_on: compliance?.registration_expires_on ?? null,
    permit_type: compliance?.permit_type ?? null,
    permit_expires_on: compliance?.permit_expires_on ?? null,
    police_clearance_on: compliance?.police_clearance_issued_on ?? null,
  });
  if (error) throw new Error(error.message);

  return employeeId;
}
