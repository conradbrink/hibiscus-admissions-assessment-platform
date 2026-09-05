import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GradeConfirmForm } from "@/components/parent/grade-confirm-form";
import { PageHeader, StepIndicator } from "@/components/parent/page-header";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadApplicationGraph } from "@/lib/applications";
import { loadCatalogue } from "@/lib/enquiry";
import { ageOn } from "@/lib/grades";
import { requireParentSession } from "@/lib/tokens/server";
import { confirmGrade } from "../actions";

export const metadata: Metadata = { title: "Confirm the grade" };

export default async function GradePage() {
  const session = await requireParentSession();
  const admin = createAdminClient();
  const [graph, catalogue] = await Promise.all([
    loadApplicationGraph(admin, session.applicationId),
    loadCatalogue(admin),
  ]);
  if (!graph) redirect("/link?reason=unknown");

  const app = graph.application;
  // Already routed: the grade is fixed from here, and the hub knows what
  // to show.
  if (!(app.status === "new_enquiry" && app.next_action === null)) redirect("/next");

  const recGrade = app.recommended_grade_id
    ? catalogue.grades.find((g) => g.id === app.recommended_grade_id) ?? null
    : null;
  const intake = catalogue.intakes.find((i) => i.id === app.intake_id) ?? catalogue.intakes[0];
  const age = intake ? ageOn(app.child_date_of_birth, intake.age_cutoff_on) : null;

  return (
    <>
      <StepIndicator step={2} total={app.entry_route === "callback" ? 1 : 3} />
      <PageHeader
        title="Confirm the grade"
        description="Check these details and change anything that is not right."
      />
      <GradeConfirmForm
        childFirstName={app.child_first_name}
        campuses={catalogue.campuses.map((c) => ({ id: c.id, name: c.name }))}
        grades={catalogue.grades.map((g) => ({
          id: g.id,
          name: g.name,
          requires_assessment: g.requires_assessment,
        }))}
        offered={catalogue.offered}
        intakes={catalogue.intakes.map((i) => ({ id: i.id, label: i.label }))}
        initial={{ campusId: app.campus_id, gradeId: app.grade_id, intakeId: app.intake_id }}
        recommended={
          recGrade && age !== null
            ? { gradeId: recGrade.id, gradeName: recGrade.name, ageOnCutoff: age }
            : null
        }
        action={confirmGrade}
      />
    </>
  );
}
