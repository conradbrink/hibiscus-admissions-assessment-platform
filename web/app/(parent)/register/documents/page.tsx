import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { DocumentUploader } from "@/components/parent/register/document-uploader";
import { RegisterShell } from "@/components/parent/register/shell";
import { SubmitButton } from "@/components/parent/register/submit-button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format-date";
import { uploadErrorText } from "@/lib/documents/upload-errors";
import { applicableRequirements, liveDocument } from "@/lib/registration/completeness";
import { registrationForSession } from "@/lib/registration/session";
import { continueFromDocuments } from "../actions";

export const metadata: Metadata = { title: "Registration — documents" };

/**
 * One uploader per applicable document. Choosing a file sends it at once,
 * straight to storage, so nothing is lost between choosing and pressing a
 * button. Without JavaScript the plain multipart form still works.
 * Rejected documents can be replaced even after submission.
 */
export default async function DocumentsStep({ searchParams }: { searchParams: Promise<{ error?: string; req?: string }> }) {
  const sp = await searchParams;
  const { graph, bundle, editable } = await registrationForSession();
  const requirements = applicableRequirements(bundle.requirements, graph.grade.sort_order);
  const error = sp.error ? uploadErrorText(sp.error) : null;

  return (
    <RegisterShell step="documents" title="Documents" description="A clear photo taken with a phone is fine, as is a PDF. Choosing a file uploads it straight away; big photos are shrunk first." readOnly={!editable}>
      <ul className="space-y-3">
        {requirements.map((q) => {
          const doc = liveDocument(bundle.documents, q.code);
          const rejected = doc?.review_status === "rejected" || doc?.scan_status === "infected";
          const canUpload = editable || rejected;
          return (
            <li key={q.code} className={`rounded-2xl border bg-card p-4 ${rejected ? "border-destructive" : doc ? "border-border" : q.required ? "border-primary" : "border-border"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{q.label}{q.required ? "" : <span className="ml-1 text-xs font-normal text-muted-foreground">(if relevant)</span>}</p>
                {doc ? (
                  rejected ? <Badge variant="destructive">please upload again</Badge> : doc.review_status === "accepted" ? <Badge variant="success">accepted</Badge> : <Badge variant="info">received</Badge>
                ) : q.required ? <Badge variant="warning">needed</Badge> : null}
              </div>
              {q.description ? <p className="mt-1 text-sm text-muted-foreground">{q.description}</p> : null}
              {doc ? (
                <p className="mt-2 flex items-center gap-2 text-sm">
                  <CheckCircle2 className="size-4 text-success" aria-hidden />
                  {doc.original_filename} · {formatDate(doc.uploaded_at)}
                </p>
              ) : null}
              {rejected && doc?.review_note ? <p className="mt-1 text-sm text-destructive">{doc.review_note}</p> : null}
              {sp.req === q.code && error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
              {canUpload ? <DocumentUploader requirement={q.code} replace={!!doc && !rejected} label={doc ? "Replace" : `Upload ${q.label.toLowerCase()}`} /> : null}
            </li>
          );
        })}
      </ul>
      {!sp.req && error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      {editable ? (
        <div className="mt-6">
          <SubmitButton action={continueFromDocuments} label="Continue" pendingLabel="One moment…" />
          <p className="mt-2 text-xs text-muted-foreground">You can come back and add documents later; registration is only complete once the required ones are here.</p>
        </div>
      ) : null}
    </RegisterShell>
  );
}
