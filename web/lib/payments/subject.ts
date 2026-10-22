/**
 * What a payment is *for*.
 *
 * There are three answers and there will never be a fourth without a
 * migration, so it is a discriminated union rather than a bag of nullable ids:
 * an admission (the application, the offer that priced it and the acceptance
 * that agreed to it), a child (the optional extras their family ordered), or
 * an event order (tickets, or a stall, bought by anybody).
 *
 * The database enforces "exactly one subject" with a check constraint. This
 * module is the only place in the application that turns that constraint into
 * columns and back, so no caller has to remember which fields go together,
 * and `reconcilePayment` can branch on a tag instead of on which ids happen to
 * be null.
 *
 * Pure, and deliberately not re-exported from any `server-only` module — the
 * same separation `lib/messaging/delivery.ts` keeps.
 */

export type PaymentSubject =
  | { kind: "admission"; applicationId: string; offerId: string; acceptanceId: string }
  | { kind: "extras"; studentId: string }
  | { kind: "event"; eventOrderId: string };

/** Just enough of a row to read its subject off. */
export type SubjectColumns = {
  application_id: string | null;
  offer_id: string | null;
  acceptance_id: string | null;
  student_id: string | null;
  event_order_id: string | null;
};

export class PaymentSubjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentSubjectError";
  }
}

const NONE: SubjectColumns = { application_id: null, offer_id: null, acceptance_id: null, student_id: null, event_order_id: null };

/**
 * The columns to insert. `kind` and `campus_id` are deliberately absent: both
 * are derived in the database from these, so sending them would only create
 * somewhere for the two to disagree.
 */
export function subjectColumns(subject: PaymentSubject): SubjectColumns {
  if (subject.kind === "admission") {
    return { ...NONE, application_id: subject.applicationId, offer_id: subject.offerId, acceptance_id: subject.acceptanceId };
  }
  if (subject.kind === "extras") return { ...NONE, student_id: subject.studentId };
  return { ...NONE, event_order_id: subject.eventOrderId };
}

/** How many of the three subjects a row names. One is the only right answer. */
function named(row: Pick<SubjectColumns, "application_id" | "student_id" | "event_order_id">): number {
  return [row.application_id, row.student_id, row.event_order_id].filter((v) => v !== null).length;
}

/**
 * The subject of a row that has been read back.
 *
 * Throws rather than returning null for a row that names none or more than
 * one. The check constraint means that cannot happen, and if it somehow has,
 * settling money against a guess is worse than failing the request: a
 * `payments` row is only ever read here on the way to deciding that somebody
 * has paid.
 */
export function subjectOf(row: SubjectColumns): PaymentSubject {
  if (named(row) > 1) {
    throw new PaymentSubjectError("This payment names more than one subject, so it cannot be settled.");
  }
  if (row.application_id !== null) {
    if (row.offer_id === null || row.acceptance_id === null) {
      throw new PaymentSubjectError("This payment names an application but not the offer and acceptance behind it.");
    }
    return { kind: "admission", applicationId: row.application_id, offerId: row.offer_id, acceptanceId: row.acceptance_id };
  }
  if (row.student_id !== null) return { kind: "extras", studentId: row.student_id };
  if (row.event_order_id !== null) return { kind: "event", eventOrderId: row.event_order_id };
  throw new PaymentSubjectError("This payment names no subject, so there is nothing to settle it against.");
}

/**
 * A payment row carries only `application_id`, `student_id` and
 * `event_order_id` — the offer and the acceptance live on its request. So its
 * subject is read with those three, and the admissions arm is identified
 * rather than reconstructed.
 */
export function subjectKindOf(row: Pick<SubjectColumns, "application_id" | "student_id" | "event_order_id">): PaymentSubject["kind"] {
  if (named(row) > 1) {
    throw new PaymentSubjectError("This payment names more than one subject, so it cannot be settled.");
  }
  if (row.application_id !== null) return "admission";
  if (row.student_id !== null) return "extras";
  if (row.event_order_id !== null) return "event";
  throw new PaymentSubjectError("This payment names no subject, so there is nothing to settle it against.");
}
