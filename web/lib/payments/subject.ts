/**
 * What a payment is *for*.
 *
 * There are two answers and there will never be a third without a migration,
 * so it is a discriminated union rather than a bag of nullable ids: an
 * admission (the application, the offer that priced it and the acceptance that
 * agreed to it) or a child (the optional extras their family ordered).
 *
 * The database enforces "exactly one subject" with a check constraint. This
 * module is the only place in the application that turns that constraint into
 * columns and back, so no caller has to remember which three fields go
 * together, and `reconcilePayment` can branch on a tag instead of on which ids
 * happen to be null.
 *
 * Pure, and deliberately not re-exported from any `server-only` module — the
 * same separation `lib/messaging/delivery.ts` keeps.
 */

export type PaymentSubject =
  | { kind: "admission"; applicationId: string; offerId: string; acceptanceId: string }
  | { kind: "extras"; studentId: string };

/** Just enough of a row to read its subject off. */
export type SubjectColumns = {
  application_id: string | null;
  offer_id: string | null;
  acceptance_id: string | null;
  student_id: string | null;
};

export class PaymentSubjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentSubjectError";
  }
}

/**
 * The columns to insert. `kind` and `campus_id` are deliberately absent: both
 * are derived in the database from these, so sending them would only create
 * somewhere for the two to disagree.
 */
export function subjectColumns(subject: PaymentSubject): SubjectColumns {
  return subject.kind === "admission"
    ? {
        application_id: subject.applicationId,
        offer_id: subject.offerId,
        acceptance_id: subject.acceptanceId,
        student_id: null,
      }
    : { application_id: null, offer_id: null, acceptance_id: null, student_id: subject.studentId };
}

/**
 * The subject of a row that has been read back.
 *
 * Throws rather than returning null for a row that names neither or both. The
 * check constraint means that cannot happen, and if it somehow has, settling
 * money against a guess is worse than failing the request: a `payments` row is
 * only ever read here on the way to deciding that a family has paid.
 */
export function subjectOf(row: SubjectColumns): PaymentSubject {
  const hasAdmission = row.application_id !== null;
  const hasStudent = row.student_id !== null;
  if (hasAdmission && hasStudent) {
    throw new PaymentSubjectError("This payment names both an application and a child, so it cannot be settled.");
  }
  if (hasAdmission) {
    if (row.offer_id === null || row.acceptance_id === null) {
      throw new PaymentSubjectError("This payment names an application but not the offer and acceptance behind it.");
    }
    return { kind: "admission", applicationId: row.application_id!, offerId: row.offer_id, acceptanceId: row.acceptance_id };
  }
  if (hasStudent) return { kind: "extras", studentId: row.student_id! };
  throw new PaymentSubjectError("This payment names no subject, so there is nothing to settle it against.");
}

/**
 * A payment row carries only `application_id` and `student_id` — the offer and
 * the acceptance live on its request. So its subject is read with those two,
 * and the admissions arm is identified rather than reconstructed.
 */
export function subjectKindOf(row: Pick<SubjectColumns, "application_id" | "student_id">): "admission" | "extras" {
  if (row.application_id !== null && row.student_id !== null) {
    throw new PaymentSubjectError("This payment names both an application and a child, so it cannot be settled.");
  }
  if (row.application_id !== null) return "admission";
  if (row.student_id !== null) return "extras";
  throw new PaymentSubjectError("This payment names no subject, so there is nothing to settle it against.");
}
