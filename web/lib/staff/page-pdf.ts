import { isUuid } from "@/lib/uuid";

/**
 * The applicant or family a staff page is about, from its address, for
 * filing a Download PDF press on their Audit tab: an applicant's page, their
 * registration's page (both by application id) and a family's page, the
 * three whose address carries the applicant's or family's own id. A page
 * about a student, a contact or an attempt names its own record, not theirs,
 * and is recorded without a subject. The address is the browser's word, so
 * the caller checks the subject under the person's own client before filing.
 */
export function pdfSubjectOf(path: string): { applicationId: string | null; familyId: string | null } {
  const none = { applicationId: null, familyId: null };
  const [, staff, area, a, b] = path.split(/[?#]/)[0].split("/");
  if (staff !== "staff") return none;
  if ((area === "applications" || area === "registrations") && isUuid(a)) return { applicationId: a, familyId: null };
  if (area === "crm" && a === "families" && isUuid(b)) return { applicationId: null, familyId: b };
  return none;
}
