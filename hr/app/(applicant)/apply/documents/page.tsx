import { ApplicantActionButton } from "@/components/applicant/action-button";
import { DocumentUploader } from "@/components/applicant/document-uploader";
import { SectionShell } from "@/components/applicant/section-shell";
import { loadDraftView } from "@/lib/applicant/load-section";
import { finishDocumentsAction } from "../actions";

export default async function DocumentsPage() {
  const view = await loadDraftView();
  const docs = view.documents;
  const body = view.campus.country === "ZA" ? "SACE" : "BTPC";
  return (
    <SectionShell title="Documents" lead="Your CV is the only document you must upload now. Copies of the others help us move faster if you are shortlisted. A clear photo from your phone is fine.">
      <div className="space-y-4">
        <DocumentUploader kind="cv" label="CV (required)" hint="A PDF or a clear photo. Up to 10 MB." documents={docs} />
        <DocumentUploader kind="certificate" label="Qualification certificates" hint="Your degree, diploma or teaching qualification." documents={docs} />
        <DocumentUploader kind="registration" label={`${body} registration`} hint="Your registration certificate or letter, if you have one." documents={docs} />
        <DocumentUploader kind="police_clearance" label="Police clearance" hint="If you have one." documents={docs} />
        {view.application.is_citizen === false ? <DocumentUploader kind="permit" label="Work or residence permit" hint="If you have one." documents={docs} /> : null}
      </div>
      <div className="mt-8 border-t border-border pt-6">
        <div className="sm:w-72">
        <ApplicantActionButton action={finishDocumentsAction} label="Save and continue" pendingLabel="Saving…" />
        </div>
      </div>
    </SectionShell>
  );
}
