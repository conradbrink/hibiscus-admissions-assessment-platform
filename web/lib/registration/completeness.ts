import type { AgreementAcceptanceRow, AgreementTemplateRow, DocumentRequirementRow, DocumentRow, RegistrationContactRow, RegistrationRow } from "@/lib/supabase/types";

/**
 * Whether a registration is complete, and if not, what is missing. Pure,
 * so it is tested and so the parent's review page, the staff queue and the
 * engine's submit rule all agree.
 */

export const SECTIONS = ["student", "medical", "family", "emergency", "documents", "agreements"] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_LABELS: Record<Section, string> = {
  student: "Student",
  medical: "Medical",
  family: "Family",
  emergency: "Emergency contacts",
  documents: "Documents",
  agreements: "Agreements",
};

export function applicableRequirements(requirements: DocumentRequirementRow[], gradeSort: number): DocumentRequirementRow[] {
  return requirements
    .filter((r) => r.is_active)
    .filter((r) => (r.grade_sort_min === null || r.grade_sort_min <= gradeSort) && (r.grade_sort_max === null || r.grade_sort_max >= gradeSort))
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** The live document for a requirement, if any: not superseded, not deleted. */
export function liveDocument(documents: DocumentRow[], code: string): DocumentRow | null {
  return documents.find((d) => d.requirement_code === code && !d.superseded_by && !d.deleted_at) ?? null;
}

export type Completeness = {
  sections: Record<Section, boolean>;
  /** Required documents with no accepted-or-pending live upload. */
  missingDocuments: DocumentRequirementRow[];
  /** Required documents whose live upload was rejected. */
  rejectedDocuments: DocumentRequirementRow[];
  missingAgreements: AgreementTemplateRow[];
  complete: boolean;
};

export function registrationCompleteness(input: {
  registration: RegistrationRow | null;
  contacts: RegistrationContactRow[];
  documents: DocumentRow[];
  requirements: DocumentRequirementRow[];
  gradeSort: number;
  agreementTemplates: AgreementTemplateRow[];
  acceptances: AgreementAcceptanceRow[];
}): Completeness {
  const r = input.registration;
  const applicable = applicableRequirements(input.requirements, input.gradeSort).filter((q) => q.required);
  const missingDocuments: DocumentRequirementRow[] = [];
  const rejectedDocuments: DocumentRequirementRow[] = [];
  for (const q of applicable) {
    const doc = liveDocument(input.documents, q.code);
    if (!doc) missingDocuments.push(q);
    else if (doc.review_status === "rejected" || doc.scan_status === "infected") rejectedDocuments.push(q);
  }
  const requiredAgreements = input.agreementTemplates.filter((t) => t.is_active && t.required);
  const acceptedIds = new Set(input.acceptances.map((a) => a.agreement_template_id));
  const missingAgreements = requiredAgreements.filter((t) => !acceptedIds.has(t.id));
  const hasPrimary = input.contacts.some((c) => c.kind === "primary_guardian");
  const hasEmergency = input.contacts.some((c) => c.kind === "emergency");

  const sections: Record<Section, boolean> = {
    student: !!r?.student_completed_at,
    medical: !!r?.medical_completed_at,
    family: !!r?.family_completed_at && hasPrimary,
    emergency: !!r?.emergency_completed_at && hasEmergency,
    documents: missingDocuments.length === 0 && rejectedDocuments.length === 0,
    agreements: missingAgreements.length === 0 && !!r?.agreements_completed_at,
  };
  return {
    sections,
    missingDocuments,
    rejectedDocuments,
    missingAgreements,
    complete: SECTIONS.every((s) => sections[s]),
  };
}

/** "Birth certificate, Vaccination card" for the emails; null when nothing is missing. */
export function missingDocumentsText(c: Pick<Completeness, "missingDocuments" | "rejectedDocuments">): string | null {
  const labels = [...c.missingDocuments.map((d) => d.label), ...c.rejectedDocuments.map((d) => `${d.label} (please upload again)`)];
  return labels.length ? labels.join(", ") : null;
}

/** The first step a parent still has to do, in order; "review" when all are done. */
export function nextStep(c: Completeness): Section | "review" {
  return SECTIONS.find((s) => !c.sections[s]) ?? "review";
}
