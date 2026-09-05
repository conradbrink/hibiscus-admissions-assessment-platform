import type { Metadata } from "next";
import { RegisterShell } from "@/components/parent/register/shell";
import { StudentForm } from "@/components/parent/register/student-form";
import { parseMismatchFlags } from "@/lib/documents/compare";
import { prefillRegistration } from "@/lib/registration/prefill";
import { registrationForSession } from "@/lib/registration/session";
import { saveStudent } from "../actions";

export const metadata: Metadata = { title: "Registration — student" };

export default async function StudentStep() {
  const { graph, bundle, editable } = await registrationForSession();
  const prefill = prefillRegistration(graph, bundle.registration, bundle.contacts.find((c) => c.kind === "primary_guardian") ?? null);
  const flags = editable ? parseMismatchFlags(bundle.registration?.mismatch_flags) : [];
  return (
    <RegisterShell step="student" title="About the student" description={`${graph.grade.name} at ${graph.campus.name}, starting ${graph.intake.label}. Grade and campus are set by the offer; tell us if they look wrong.`} readOnly={!editable}>
      {flags.length ? (
        <div className="mb-5 rounded-2xl border border-warning/50 bg-warning/10 p-4 text-sm">
          <p className="font-semibold">Please check {flags.length === 1 ? "one detail" : "a few details"} against the document you uploaded</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {flags.map((f) => (
              <li key={`${f.document_id}-${f.field}`}>
                <span className="font-medium">{f.label}:</span> the {f.requirement_code.replace(/_/g, " ")} shows <span className="font-medium">{f.document_value ?? "—"}</span>; the form says <span className="font-medium">{f.registration_value ?? "—"}</span>.
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">If the document is right, correct the form below. If the form is right, leave it and save; the school will follow up. Nothing has been changed for you.</p>
        </div>
      ) : null}
      <StudentForm action={saveStudent} initial={prefill.student} prefilled={prefill.prefilledFields} readOnly={!editable} />
    </RegisterShell>
  );
}
