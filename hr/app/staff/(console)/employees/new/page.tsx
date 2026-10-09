import { ActionForm } from "@/components/staff/action-form";
import { EmployeeFields } from "@/components/employees/employee-fields";
import { PageTitle } from "@/components/staff/page-title";
import { accessibleCampuses } from "@/lib/recruitment/campuses";
import { requireStaff } from "@/lib/staff/session";
import { createEmployeeAction } from "../actions";

export const metadata = { title: "Add employee" };

export default async function NewEmployeePage() {
  const ctx = await requireStaff("hr.employees.write");
  const [campuses, { data: departments }] = await Promise.all([accessibleCampuses(ctx.supabase), ctx.supabase.from("hr_departments").select("id, name").order("name")]);
  return (
    <>
      <PageTitle
        title="Add employee"
        description="For someone who joined before this system. New staff hired through the pipeline are added for you when you press Hire."
        back={{ href: "/staff/employees", label: "Employees" }}
      />
      <ActionForm action={createEmployeeAction} label="Add employee" size="lg" resetOnSubmit={false} className="surface max-w-3xl space-y-5 p-6">
        <EmployeeFields initial={{ campus_id: campuses.length === 1 ? campuses[0].id : undefined }} campuses={campuses} departments={departments ?? []} />
      </ActionForm>
    </>
  );
}
