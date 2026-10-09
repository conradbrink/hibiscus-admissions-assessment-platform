import { PageTitle } from "@/components/staff/page-title";
import { VacancyForm } from "@/components/recruitment/vacancy-form";
import { accessibleCampuses } from "@/lib/recruitment/campuses";
import { requireStaff } from "@/lib/staff/session";
import { createVacancyAction } from "../../actions";

export default async function NewVacancyPage() {
  const ctx = await requireStaff("hr.recruitment.write");
  const campuses = await accessibleCampuses(ctx.supabase);
  return (
    <>
      <PageTitle title="New vacancy" description="Saved as a draft. Next you choose and approve the interview questions, then publish." back={{ href: "/staff/recruitment/vacancies", label: "Vacancies" }} />
      <VacancyForm
        action={createVacancyAction}
        campuses={campuses}
        submitLabel="Save and choose questions"
        initial={{ campus_id: campuses.length === 1 ? campuses[0].id : "", title: "", phase: "preschool", subject: "", grade_range: "", employment_type: "permanent", summary: "", description: "", requirements: "", salary_note: "", starts_on: "", closes_on: "" }}
      />
    </>
  );
}
