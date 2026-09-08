import type { Metadata } from "next";
import Link from "next/link";
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

export default async function GradePage({ searchParams }: { searchParams: Promise<{ preschool?: string }> }) {
  const { preschool: preschoolParam } = await searchParams;
  const preschool = preschoolParam === "1";
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

  // Through the pre-school door only the classes without an assessment are
  // offered, and the recommendation is shown only if it is one of them. A
  // child too old for pre-school is pointed at the full list.
  const grades = preschool ? catalogue.grades.filter((g) => !g.requires_assessment) : catalogue.grades;
  const recommendedShown = recGrade && (!preschool || !recGrade.requires_assessment) ? recGrade : null;
  const gradeIds = new Set(grades.map((g) => g.id));
  const initialGradeId = gradeIds.has(app.grade_id)
    ? app.grade_id
    : (grades.find((g) => (catalogue.offered[app.campus_id] ?? []).includes(g.id))?.id ?? app.grade_id);

  return (
    <>
      <StepIndicator step={2} total={app.entry_route === "callback" ? 1 : 3} />
      <PageHeader
        title={preschool ? "Confirm the pre-school class" : "Confirm the grade"}
        description={
          preschool
            ? "Choose the class, campus and start term. Pre-school children do not sit an assessment."
            : "Check these details and change anything that is not right."
        }
      />
      <GradeConfirmForm
        childFirstName={app.child_first_name}
        campuses={catalogue.campuses.map((c) => ({ id: c.id, name: c.name }))}
        grades={grades.map((g) => ({
          id: g.id,
          name: g.name,
          requires_assessment: g.requires_assessment,
        }))}
        offered={catalogue.offered}
        intakes={catalogue.intakes.map((i) => ({ id: i.id, label: i.label }))}
        initial={{ campusId: app.campus_id, gradeId: initialGradeId, intakeId: app.intake_id }}
        recommended={
          recommendedShown && age !== null
            ? { gradeId: recommendedShown.id, gradeName: recommendedShown.name, ageOnCutoff: age }
            : null
        }
        action={confirmGrade}
      />
      {preschool ? (
        <p className="mt-6 text-sm text-muted-foreground">
          {recGrade && recGrade.requires_assessment
            ? `Based on ${app.child_first_name}’s age we would suggest ${recGrade.name}, which sits a short assessment. `
            : "Joining Reception or above instead? "}
          <Link href="/next/grade" className="font-medium text-primary underline underline-offset-4">See all grades</Link>
        </p>
      ) : null}
    </>
  );
}
