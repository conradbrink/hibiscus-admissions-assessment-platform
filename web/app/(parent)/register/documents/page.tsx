import type { Metadata } from "next";
import { CheckCircle2, Upload } from "lucide-react";
import { RegisterShell } from "@/components/parent/register/shell";
import { SubmitButton } from "@/components/parent/register/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format-date";
import { applicableRequirements, liveDocument } from "@/lib/registration/completeness";
import { registrationForSession } from "@/lib/registration/session";
import { continueFromDocuments } from "../actions";

export const metadata: Metadata = { title: "Registration — documents" };

const ERRORS: Record<string, string> = {
  too_large: "That file is larger than 10 MB. A photo from a phone or a PDF is usually well under that.",
  bad_type: "We can accept a PDF, a JPEG or a PNG. That file was something else.",
  empty: "That file was empty. Please choose it again.",
  unknown_requirement: "We did not recognise which document that was for. Please try again.",
  not_open: "Documents can only be changed while registration is open.",
  busy: "Too many uploads in a short time. Please wait a minute and try again.",
  failed: "The upload did not go through. Please try again.",
};

/**
 * One upload form per applicable document. A plain multipart form to a
 * route handler: no JavaScript needed, and a phone camera works as a file
 * picker. Rejected documents can be replaced even after submission.
 */
export default async function DocumentsStep({ searchParams }: { searchParams: Promise<{ error?: string; req?: string }> }) {
  const sp = await searchParams;
  const { graph, bundle, editable } = await registrationForSession();
  const requirements = applicableRequirements(bundle.requirements, graph.grade.sort_order);
  const error = sp.error ? ERRORS[sp.error] ?? ERRORS.failed : null;

  return (
    <RegisterShell step="documents" title="Documents" description="A clear photo taken with a phone is fine, as is a PDF. Up to 10 MB each." readOnly={!editable}>
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
              {canUpload ? (
                <form method="post" action="/api/register/document" encType="multipart/form-data" className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input type="hidden" name="requirement" value={q.code} />
                  <input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" required className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium" />
                  <Button type="submit" variant={doc && !rejected ? "outline" : "default"} size="sm"><Upload data-icon="inline-start" /> {doc ? "Replace" : "Upload"}</Button>
                </form>
              ) : null}
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
