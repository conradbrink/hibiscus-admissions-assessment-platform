import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  APPLICANT_COOKIE,
  decodeApplicantSession,
  decodePayslipSession,
  decodeRefereeSession,
  encodeApplicantSession,
  encodePayslipSession,
  encodeRefereeSession,
  PAYSLIP_COOKIE,
  REFEREE_COOKIE,
  type ApplicantSession,
  type PayslipSession,
  type RefereeSession,
} from "@/lib/tokens/session";

function secret(): string {
  const s = process.env.HR_SESSION_SECRET;
  if (!s) throw new Error("HR_SESSION_SECRET is not set.");
  return s;
}

const cookieBase = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const };

// An applicant may take a week over a long form; the cookie lasts a day and
// the emailed link brings them back.
const APPLICANT_TTL_MINUTES = 24 * 60;
const REFEREE_TTL_MINUTES = 2 * 60;
// Long enough to read and download a payslip; the emailed link opens it again.
const PAYSLIP_TTL_MINUTES = 30;

export async function startApplicantSession(applicationId: string): Promise<void> {
  const now = Date.now();
  const store = await cookies();
  store.set(
    APPLICANT_COOKIE,
    encodeApplicantSession({ applicationId, issuedAt: now, expiresAt: now + APPLICANT_TTL_MINUTES * 60_000 }, secret()),
    { ...cookieBase, path: "/", maxAge: APPLICANT_TTL_MINUTES * 60 }
  );
}

export async function readApplicantSession(): Promise<ApplicantSession | null> {
  const store = await cookies();
  return decodeApplicantSession(store.get(APPLICANT_COOKIE)?.value, secret());
}

export async function requireApplicantSession(): Promise<ApplicantSession> {
  const session = await readApplicantSession();
  if (!session) redirect("/apply/link?expired=1");
  return session;
}

export async function endApplicantSession(): Promise<void> {
  const store = await cookies();
  store.delete(APPLICANT_COOKIE);
}

export async function startRefereeSession(referenceRequestId: string): Promise<void> {
  const now = Date.now();
  const store = await cookies();
  store.set(
    REFEREE_COOKIE,
    encodeRefereeSession({ referenceRequestId, issuedAt: now, expiresAt: now + REFEREE_TTL_MINUTES * 60_000 }, secret()),
    { ...cookieBase, path: "/reference", maxAge: REFEREE_TTL_MINUTES * 60 }
  );
}

export async function readRefereeSession(): Promise<RefereeSession | null> {
  const store = await cookies();
  return decodeRefereeSession(store.get(REFEREE_COOKIE)?.value, secret());
}

export async function requireRefereeSession(): Promise<RefereeSession> {
  const session = await readRefereeSession();
  if (!session) redirect("/reference/expired");
  return session;
}

export async function endRefereeSession(): Promise<void> {
  const store = await cookies();
  store.delete({ name: REFEREE_COOKIE, path: "/reference" });
}

export async function startPayslipSession(payslipId: string): Promise<void> {
  const now = Date.now();
  const store = await cookies();
  store.set(
    PAYSLIP_COOKIE,
    encodePayslipSession({ payslipId, issuedAt: now, expiresAt: now + PAYSLIP_TTL_MINUTES * 60_000 }, secret()),
    { ...cookieBase, path: "/payslip", maxAge: PAYSLIP_TTL_MINUTES * 60 }
  );
}

export async function readPayslipSession(): Promise<PayslipSession | null> {
  const store = await cookies();
  return decodePayslipSession(store.get(PAYSLIP_COOKIE)?.value, secret());
}
