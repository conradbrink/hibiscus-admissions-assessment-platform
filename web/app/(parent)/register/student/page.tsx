import type { Metadata } from "next";
import { RegisterShell } from "@/components/parent/register/shell";
import { StudentForm } from "@/components/parent/register/student-form";
import { prefillRegistration } from "@/lib/registration/prefill";
import { registrationForSession } from "@/lib/registration/session";
import { saveStudent } from "../actions";

export const metadata: Metadata = { title: "Registration — student" };

export default async function StudentStep() {
  const { graph, bundle, editable } = await registrationForSession();
  const prefill = prefillRegistration(graph, bundle.registration, bundle.contacts.find((c) => c.kind === "primary_guardian") ?? null);
  return (
    <RegisterShell step="student" title="About the student" description={`${graph.grade.name} at ${graph.campus.name}, starting ${graph.intake.label}. Grade and campus are set by the offer; tell us if they look wrong.`} readOnly={!editable}>
      <StudentForm action={saveStudent} initial={prefill.student} prefilled={prefill.prefilledFields} readOnly={!editable} />
    </RegisterShell>
  );
}
