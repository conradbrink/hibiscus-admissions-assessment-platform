import type { Metadata } from "next";
import { RegisterShell } from "@/components/parent/register/shell";
import { StudentForm } from "@/components/parent/register/student-form";
import { DocumentUploader } from "@/components/parent/register/document-uploader";
import { parseMismatchFlags } from "@/lib/documents/compare";
import { getDocumentExtractor } from "@/lib/documents/extractor";
import { liveDocument } from "@/lib/registration/completeness";
import { prefillRegistration, type CertificateReading } from "@/lib/registration/prefill";
import { registrationForSession } from "@/lib/registration/session";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";
import { saveStudent } from "../actions";

export const metadata: Metadata = { title: "Registration — student" };

export default async function StudentStep() {
  const { admin, graph, bundle, editable } = await registrationForSession();
  const [{ data: grades }, settings] = await Promise.all([
    createAdminClient().from("grades").select("name").eq("is_active", true).order("sort_order"),
    getSettings(admin),
  ]);
  // "Upload the certificate and we fill in what it says" only when a reader is configured and switched on.
  const readingOn = settings.aiExtractionEnabled && getDocumentExtractor().name !== "none";
  const certificate = liveDocument(bundle.documents, "birth_certificate");
  const reading: CertificateReading | null =
    certificate?.extraction_status === "done" && certificate.extracted_fields && typeof certificate.extracted_fields === "object" && !Array.isArray(certificate.extracted_fields)
      ? { fields: certificate.extracted_fields as Record<string, Json> }
      : null;
  const prefill = prefillRegistration(graph, bundle.registration, bundle.contacts.find((c) => c.kind === "primary_guardian") ?? null, reading);
  const flags = editable ? parseMismatchFlags(bundle.registration?.mismatch_flags) : [];
  const studentSaved = !!bundle.registration?.student_completed_at;
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
      {editable && readingOn && !studentSaved ? (
        <div className="mb-5 rounded-2xl border border-primary/40 bg-primary/5 p-4 text-sm">
          {reading ? (
            <p className="font-semibold">We read the birth certificate you uploaded. The details it gave are marked below; please check them before you save.</p>
          ) : certificate && certificate.extraction_status !== "failed" ? (
            <p className="font-semibold">Thank you, we have the birth certificate. If it can be read, this page fills itself in; reload in a moment.</p>
          ) : (
            <>
              <p className="font-semibold">Have the birth certificate handy?</p>
              <p className="mt-1 text-muted-foreground">Upload a photo of it now and we fill in what it says: full names, place of birth, gender and the registration number. You check, then save.</p>
            </>
          )}
          {!reading ? <DocumentUploader requirement="birth_certificate" label={certificate ? "Replace the birth certificate" : "Upload the birth certificate"} variant={certificate ? "outline" : "default"} replace={!!certificate} waitForReading /> : null}
        </div>
      ) : null}
      <StudentForm action={saveStudent} initial={prefill.student} prefilled={prefill.prefilledFields} readOnly={!editable} grades={(grades ?? []).map((g) => g.name)} fromDocument={prefill.fromDocument} />
    </RegisterShell>
  );
}
