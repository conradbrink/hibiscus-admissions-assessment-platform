import type { EnrolmentStatus, StudentStatus } from "@/lib/supabase/types";

/**
 * How the register reads. Staff-facing, so denser than the parent wording,
 * but the same rule holds: one word for one thing.
 */
export const STUDENT_STATUS_LABELS: Record<StudentStatus, string> = {
  onboarding: "Starting",
  active: "Attending",
  on_leave: "On leave",
  left: "Left",
  graduated: "Graduated",
};

export const STUDENT_STATUS_TONE: Record<StudentStatus, "info" | "success" | "warning" | "muted"> = {
  onboarding: "info",
  active: "success",
  on_leave: "warning",
  left: "muted",
  graduated: "muted",
};

export const ENROLMENT_STATUS_LABELS: Record<EnrolmentStatus, string> = {
  pending: "Place held",
  active: "Attending",
  not_returning: "Not returning",
  left: "Left",
  completed: "Completed",
  transferred: "Transferred",
};

/** The name the school would use: what the family calls the child. */
export function studentName(s: { legal_first_name: string; legal_last_name: string; preferred_name: string | null }): string {
  return `${s.preferred_name || s.legal_first_name} ${s.legal_last_name}`;
}

/** The full legal name, for a document or a check against another system. */
export function studentLegalName(s: { legal_first_name: string; legal_middle_names: string | null; legal_last_name: string }): string {
  return [s.legal_first_name, s.legal_middle_names, s.legal_last_name].filter(Boolean).join(" ");
}
