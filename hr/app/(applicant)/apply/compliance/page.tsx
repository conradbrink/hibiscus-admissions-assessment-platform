import { ComplianceForm } from "@/components/applicant/compliance-form";
import { SectionShell } from "@/components/applicant/section-shell";
import { loadDraftView } from "@/lib/applicant/load-section";

const yn = (v: boolean | null | undefined) => (v === null || v === undefined ? "" : v ? "yes" : "no");

export default async function CompliancePage() {
  const view = await loadDraftView();
  const c = view.compliance;
  return (
    <SectionShell
      title="Permission to teach"
      lead="Your registration, your right to work, and the safeguarding questions we ask every applicant. If something is not ready yet, say so: it does not stop you applying."
    >
      <ComplianceForm
        country={view.campus.country}
        initial={{
          registration_body: c?.registration_body ?? "",
          registration_number: c?.registration_number ?? "",
          registration_expires_on: c?.registration_expires_on ?? "",
          needs_permit: yn(c?.needs_permit ?? (view.application.is_citizen ? false : null)),
          permit_type: c?.permit_type ?? "",
          permit_number: c?.permit_number ?? "",
          permit_expires_on: c?.permit_expires_on ?? "",
          police_clearance: c?.police_clearance ?? "",
          police_clearance_issued_on: c?.police_clearance_issued_on ?? "",
          child_protection_clear: yn(c?.child_protection_clear),
          criminal_record: yn(c?.criminal_record),
          criminal_record_detail: c?.criminal_record_detail ?? "",
          dismissed_before: yn(c?.dismissed_before),
          dismissed_detail: c?.dismissed_detail ?? "",
          safeguarding_concern: yn(c?.safeguarding_concern),
          safeguarding_detail: c?.safeguarding_detail ?? "",
          declaration_name: c?.declaration_name ?? "",
        }}
      />
    </SectionShell>
  );
}
