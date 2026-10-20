/**
 * What a payment is *for*.
 *
 * There are three answers, and a fourth would need a migration, so it is a
 * discriminated union rather than a bag of nullable ids: an admission (the
 * application, the offer that priced it and the acceptance that agreed to
 * it), a child (the optional extras their family ordered), or a school
 * transport booking (a household's children on the shuttle for a period).
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
  | { kind: "transport"; transportBookingId: string };

export type PaymentSubjectKind = PaymentSubject["kind"];

/** Just enough of a row to read its subject off. */
export type SubjectColumns = {
  application_id: string | null;
  offer_id: string | null;
  acceptance_id: string | null;
  student_id: string | null;
  transport_booking_id: string | null;
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
  const none: SubjectColumns = { application_id: null, offer_id: null, acceptance_id: null, student_id: null, transport_booking_id: null };
  switch (subject.kind) {
    case "admission":
      return { ...none, application_id: subject.applicationId, offer_id: subject.offerId, acceptance_id: subject.acceptanceId };
    case "extras":
      return { ...none, student_id: subject.studentId };
    case "transport":
      return { ...none, transport_booking_id: subject.transportBookingId };
  }
}

function namedKinds(row: Pick<SubjectColumns, "application_id" | "student_id" | "transport_booking_id">): PaymentSubjectKind[] {
  const kinds: PaymentSubjectKind[] = [];
  if (row.application_id !== null) kinds.push("admission");
  if (row.student_id !== null) kinds.push("extras");
  if (row.transport_booking_id !== null) kinds.push("transport");
  return kinds;
}

/**
 * The subject of a row that has been read back.
 *
 * Throws rather than returning null for a row that names none or several. The
 * check constraint means that cannot happen, and if it somehow has, settling
 * money against a guess is worse than failing the request: a `payments` row is
 * only ever read here on the way to deciding that a family has paid.
 */
export function subjectOf(row: SubjectColumns): PaymentSubject {
  const kind = subjectKindOf(row);
  switch (kind) {
    case "admission":
      if (row.offer_id === null || row.acceptance_id === null) {
        throw new PaymentSubjectError("This payment names an application but not the offer and acceptance behind it.");
      }
      return { kind, applicationId: row.application_id!, offerId: row.offer_id, acceptanceId: row.acceptance_id };
    case "extras":
      return { kind, studentId: row.student_id! };
    case "transport":
      return { kind, transportBookingId: row.transport_booking_id! };
  }
}

/**
 * A payment row carries the subject ids but not the offer and acceptance —
 * those live on its request. So its kind is read from the ids alone, and the
 * admissions arm is identified rather than reconstructed.
 *
 * `transport_booking_id` may be missing from a row typed before transport
 * existed; it is read as null rather than trusted to be there.
 */
export function subjectKindOf(
  row: Pick<SubjectColumns, "application_id" | "student_id"> & { transport_booking_id?: string | null }
): PaymentSubjectKind {
  const kinds = namedKinds({ ...row, transport_booking_id: row.transport_booking_id ?? null });
  if (kinds.length > 1) throw new PaymentSubjectError(`This payment names more than one subject (${kinds.join(" and ")}), so it cannot be settled.`);
  if (kinds.length === 0) throw new PaymentSubjectError("This payment names no subject, so there is nothing to settle it against.");
  return kinds[0];
}
