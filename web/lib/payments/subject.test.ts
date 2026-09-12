import { describe, expect, it } from "vitest";
import { PaymentSubjectError, subjectColumns, subjectKindOf, subjectOf, type PaymentSubject } from "@/lib/payments/subject";

const ADMISSION: PaymentSubject = { kind: "admission", applicationId: "app-1", offerId: "offer-1", acceptanceId: "acc-1" };
const EXTRAS: PaymentSubject = { kind: "extras", studentId: "stu-1" };

describe("subjectColumns", () => {
  it("names the whole admissions triple and no child", () => {
    expect(subjectColumns(ADMISSION)).toEqual({
      application_id: "app-1",
      offer_id: "offer-1",
      acceptance_id: "acc-1",
      student_id: null,
    });
  });

  it("names the child and nothing from the funnel", () => {
    expect(subjectColumns(EXTRAS)).toEqual({
      application_id: null,
      offer_id: null,
      acceptance_id: null,
      student_id: "stu-1",
    });
  });

  it("round-trips through the columns", () => {
    expect(subjectOf(subjectColumns(ADMISSION))).toEqual(ADMISSION);
    expect(subjectOf(subjectColumns(EXTRAS))).toEqual(EXTRAS);
  });
});

describe("subjectOf", () => {
  it("refuses a row naming both", () => {
    expect(() => subjectOf({ ...subjectColumns(ADMISSION), student_id: "stu-1" })).toThrow(PaymentSubjectError);
  });

  it("refuses a row naming neither", () => {
    expect(() => subjectOf({ application_id: null, offer_id: null, acceptance_id: null, student_id: null })).toThrow(
      PaymentSubjectError
    );
  });

  it("refuses an application without the offer behind it", () => {
    // The check constraint makes this impossible, and settling money against a
    // guess would be worse than the throw.
    expect(() => subjectOf({ application_id: "app-1", offer_id: null, acceptance_id: "acc-1", student_id: null })).toThrow(
      /not the offer and acceptance/
    );
  });
});

describe("subjectKindOf", () => {
  it("reads a payment row, which carries no offer or acceptance", () => {
    expect(subjectKindOf({ application_id: "app-1", student_id: null })).toBe("admission");
    expect(subjectKindOf({ application_id: null, student_id: "stu-1" })).toBe("extras");
  });

  it("refuses both and neither", () => {
    expect(() => subjectKindOf({ application_id: "app-1", student_id: "stu-1" })).toThrow(PaymentSubjectError);
    expect(() => subjectKindOf({ application_id: null, student_id: null })).toThrow(PaymentSubjectError);
  });
});
