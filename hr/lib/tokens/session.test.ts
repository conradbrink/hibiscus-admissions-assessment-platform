import { describe, expect, it } from "vitest";
import {
  decodeApplicantSession,
  decodePayslipSession,
  decodeRefereeSession,
  encodeApplicantSession,
  encodePayslipSession,
  encodeRefereeSession,
} from "@/lib/tokens/session";

const SECRET = "test-secret-that-is-long-enough-for-hmac";
const now = 1_800_000_000_000;

describe("the applicant cookie", () => {
  const value = encodeApplicantSession({ applicationId: "app-1", issuedAt: now, expiresAt: now + 60_000 }, SECRET);

  it("round-trips", () => {
    expect(decodeApplicantSession(value, SECRET, now)?.applicationId).toBe("app-1");
  });

  it("is refused once expired", () => {
    expect(decodeApplicantSession(value, SECRET, now + 60_001)).toBeNull();
  });

  it("is refused with another secret", () => {
    expect(decodeApplicantSession(value, "another-secret", now)).toBeNull();
  });

  it("is refused when tampered with", () => {
    const [payload, sig] = value.split(".");
    const forged = Buffer.from(JSON.stringify({ s: "app-2", i: now, e: now + 60_000 })).toString("base64url");
    expect(decodeApplicantSession(`${forged}.${sig}`, SECRET, now)).toBeNull();
    expect(decodeApplicantSession(`${payload}.x${sig}`, SECRET, now)).toBeNull();
  });
});

describe("the cookies cannot be swapped", () => {
  it("an applicant cookie is not a referee cookie", () => {
    const applicant = encodeApplicantSession({ applicationId: "req-1", issuedAt: now, expiresAt: now + 60_000 }, SECRET);
    expect(decodeRefereeSession(applicant, SECRET, now)).toBeNull();
  });

  it("a referee cookie is not an applicant cookie", () => {
    // The case that matters: an applicant who could pass a referee cookie as
    // their own could read their references.
    const referee = encodeRefereeSession({ referenceRequestId: "app-1", issuedAt: now, expiresAt: now + 60_000 }, SECRET);
    expect(decodeApplicantSession(referee, SECRET, now)).toBeNull();
  });

  it("a payslip cookie opens no application or reference, and they open no payslip", () => {
    const payslip = encodePayslipSession({ payslipId: "x-1", issuedAt: now, expiresAt: now + 60_000 }, SECRET);
    expect(decodeApplicantSession(payslip, SECRET, now)).toBeNull();
    expect(decodeRefereeSession(payslip, SECRET, now)).toBeNull();
    expect(decodePayslipSession(payslip, SECRET, now)?.payslipId).toBe("x-1");
    const applicant = encodeApplicantSession({ applicationId: "x-1", issuedAt: now, expiresAt: now + 60_000 }, SECRET);
    expect(decodePayslipSession(applicant, SECRET, now)).toBeNull();
  });
});
