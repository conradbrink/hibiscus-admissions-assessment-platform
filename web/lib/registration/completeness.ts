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

/**
 * The agreements this applicant is actually asked for.
 *
 * The same filter as `applicableRequirements` above, on purpose: the learner
 * code of conduct is a code a *learner* signs up to, and a family registering
 * a toddler has no use for rules about uniform and homework. Scoping it by
 * `grades.sort_order` is how the document requirements have worked since
 * Phase 3, so this reads the same and behaves the same.
 *
 * Applied both where the parent's list is built and where completeness is
 * judged. If only one of the two applied it, a pre-school family would be
 * blocked on an agreement the screen never showed them.
 */
export function applicableAgreements(templates: AgreementTemplateRow[], gradeSort: number): AgreementTemplateRow[] {
  return templates
    .filter((t) => t.is_active)
    .filter((t) => (t.grade_sort_min === null || t.grade_sort_min <= gradeSort) && (t.grade_sort_max === null || t.grade_sort_max >= gradeSort))
    .sort((a, b) => a.sort_order - b.sort_order);
}

/**
 * Whether this agreement has been answered in a way that lets the parent move
 * on.
 *
 * The distinction the photographs consent exists for: an agreement the school
 * may not proceed without needs `accepted`, but one the parent is entitled to
 * refuse needs only an *answer*. Treating a refusal as "still outstanding"
 * would make the choice a fiction — the parent would sit on the same screen
 * until they changed their mind, which is not consent, it is attrition.
 */
export function agreementSatisfied(template: AgreementTemplateRow, acceptance: AgreementAcceptanceRow | undefined): boolean {
  if (!acceptance) return false;
  if (template.may_decline) return true;
  return acceptance.decision === "accepted";
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
  const requiredAgreements = applicableAgreements(input.agreementTemplates, input.gradeSort).filter((t) => t.required);
  const answers = new Map(input.acceptances.map((a) => [a.agreement_template_id, a]));
  const missingAgreements = requiredAgreements.filter((t) => !agreementSatisfied(t, answers.get(t.id)));
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

/**
 * Everything still outstanding after a submission, in one plain sentence
 * fragment for the confirmation email: the sections not yet filled in, then
 * the documents still needed. Null when nothing is outstanding.
 */
export function outstandingItemsText(c: Pick<Completeness, "sections" | "missingDocuments" | "rejectedDocuments">): string | null {
  const sections = SECTIONS.filter((s) => s !== "documents" && !c.sections[s]).map((s) => `the ${SECTION_LABELS[s]} section`);
  const documents = missingDocumentsText(c);
  const parts = [...sections, ...(documents ? [`these documents: ${documents}`] : [])];
  return parts.length ? parts.join("; ") : null;
}

/** The first step a parent still has to do, in order; "review" when all are done. */
export function nextStep(c: Completeness): Section | "review" {
  return SECTIONS.find((s) => !c.sections[s]) ?? "review";
}
