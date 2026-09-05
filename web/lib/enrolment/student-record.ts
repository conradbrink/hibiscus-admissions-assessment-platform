import type { ApplicationGraph } from "@/lib/applications";
import type { RegistrationBundle } from "@/lib/registration/load";
import type { PaymentRequestRow, PaymentRow } from "@/lib/supabase/types";

/**
 * The enrolment snapshot: everything a student management system needs,
 * as plain JSON, versioned so a later importer knows what it is reading.
 * Pure: built from the bundle, never from live tables at export time.
 */
export type StudentRecordSnapshot = {
  schema_version: 1;
  generated_at: string;
  application: { reference: string; campus: string; campus_code: string; grade: string; intake: string; start_date: string | null };
  student: {
    legal_first_name: string | null;
    legal_middle_names: string | null;
    legal_last_name: string | null;
    preferred_name: string | null;
    gender: string | null;
    date_of_birth: string | null;
    nationality: string | null;
    country_of_birth: string | null;
    place_of_birth: string | null;
    home_language: string | null;
    identity_type: string | null;
    identity_number: string | null;
    previous_institution: string | null;
    current_grade: string | null;
  };
  guardians: Array<{ kind: string; first_name: string; last_name: string; relationship: string; email: string | null; mobile: string | null; phone: string | null; address: string | null; nationality: string | null }>;
  emergency_contacts: Array<{ first_name: string; last_name: string; relationship: string; phone: string | null; email: string | null; address: string | null }>;
  medical: {
    medical_aid_name: string | null;
    medical_aid_number: string | null;
    medical_aid_principal_member: string | null;
    emergency_treatment_consent: boolean | null;
    allergies: string | null;
    medical_conditions: string | null;
    medication: string | null;
    medical_notes: string | null;
    vaccination_notes: string | null;
  };
  documents: Array<{ code: string; label: string; filename: string; sha256: string; review_status: string; uploaded_at: string }>;
  agreements: Array<{ key: string; version: number; signature_name: string; accepted_at: string }>;
  payment: { currency: string; amount_minor: number; paid_at: string | null; receipts: Array<{ method: string; amount_minor: number; reference: string; paid_on: string }> } | null;
};

export function buildStudentRecord(
  graph: Pick<ApplicationGraph, "application" | "campus" | "grade" | "intake">,
  bundle: RegistrationBundle,
  payment: { request: PaymentRequestRow | null; payments: PaymentRow[] },
  now: Date = new Date()
): StudentRecordSnapshot {
  const r = bundle.registration;
  const label = (code: string) => bundle.requirements.find((q) => q.code === code)?.label ?? code;
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    application: {
      reference: graph.application.reference,
      campus: graph.campus.name,
      campus_code: graph.campus.code,
      grade: graph.grade.name,
      intake: graph.intake.label,
      start_date: graph.intake.starts_on,
    },
    student: {
      legal_first_name: r?.legal_first_name ?? graph.application.child_first_name,
      legal_middle_names: r?.legal_middle_names ?? null,
      legal_last_name: r?.legal_last_name ?? graph.application.child_last_name,
      preferred_name: r?.preferred_name ?? null,
      gender: r?.gender ?? null,
      date_of_birth: r?.date_of_birth ?? graph.application.child_date_of_birth,
      nationality: r?.nationality ?? null,
      country_of_birth: r?.country_of_birth ?? null,
      place_of_birth: r?.place_of_birth ?? null,
      home_language: r?.home_language ?? null,
      identity_type: r?.identity_type ?? null,
      identity_number: r?.identity_number ?? null,
      previous_institution: r?.previous_institution ?? null,
      current_grade: r?.current_grade ?? null,
    },
    guardians: bundle.contacts
      .filter((c) => c.kind !== "emergency")
      .map((c) => ({ kind: c.kind, first_name: c.first_name, last_name: c.last_name, relationship: c.relationship, email: c.email, mobile: c.mobile_normalised ?? c.mobile, phone: c.phone, address: c.address, nationality: c.nationality })),
    emergency_contacts: bundle.contacts
      .filter((c) => c.kind === "emergency")
      .map((c) => ({ first_name: c.first_name, last_name: c.last_name, relationship: c.relationship, phone: c.phone, email: c.email, address: c.address })),
    medical: {
      medical_aid_name: r?.medical_aid_name ?? null,
      medical_aid_number: r?.medical_aid_number ?? null,
      medical_aid_principal_member: r?.medical_aid_principal_member ?? null,
      emergency_treatment_consent: r?.emergency_treatment_consent ?? null,
      allergies: r?.allergies ?? null,
      medical_conditions: r?.medical_conditions ?? null,
      medication: r?.medication ?? null,
      medical_notes: r?.medical_notes ?? null,
      vaccination_notes: r?.vaccination_notes ?? null,
    },
    documents: bundle.documents
      .filter((d) => !d.superseded_by && !d.deleted_at)
      .map((d) => ({ code: d.requirement_code, label: label(d.requirement_code), filename: d.original_filename, sha256: d.sha256, review_status: d.review_status, uploaded_at: d.uploaded_at })),
    agreements: bundle.acceptances.map((a) => ({ key: a.template_key, version: a.template_version, signature_name: a.signature_name, accepted_at: a.accepted_at })),
    payment: payment.request
      ? {
          currency: payment.request.currency,
          amount_minor: Number(payment.request.amount_minor),
          paid_at: payment.request.paid_at,
          receipts: payment.payments
            .filter((p) => p.status === "succeeded")
            .map((p) => ({ method: p.method, amount_minor: Number(p.amount_minor), reference: p.method === "eft" ? (p.bank_reference ?? p.company_ref) : p.company_ref, paid_on: p.received_on ?? p.updated_at })),
        }
      : null,
  };
}
