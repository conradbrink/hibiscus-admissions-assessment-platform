import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { AdminClient } from "@/lib/supabase/admin";
import type { HrTokenPurpose } from "@/lib/supabase/types";

/**
 * HR magic links. 32 random bytes, base64url; only the SHA-256 hash is
 * stored. `/h/<token>` is an applicant's link, `/r/<token>` a referee's,
 * `/p/<token>` an employee's payslip. Each route exchanges the token once for
 * a scoped cookie and redirects to a clean address.
 */

export const TOKEN_BYTES = 32;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export function siteUrl(): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL;
  if (!base) throw new Error("NEXT_PUBLIC_SITE_URL is not set.");
  return base.replace(/\/+$/, "");
}

const PREFIX: Record<HrTokenPurpose, string> = { application: "h", reference: "r", payslip: "p" };

export type MintSubject =
  | { purpose: "application"; applicationId: string }
  | { purpose: "reference"; referenceRequestId: string }
  | { purpose: "payslip"; payslipId: string };

export async function mintToken(
  admin: AdminClient,
  subject: MintSubject,
  opts: { ttlDays: number; maxUses?: number | null; reason?: string }
): Promise<{ token: string; url: string; expiresAt: Date }> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + opts.ttlDays * 86_400_000);
  const { error } = await admin.from("hr_access_tokens").insert({
    purpose: subject.purpose,
    hr_application_id: subject.purpose === "application" ? subject.applicationId : null,
    hr_reference_request_id: subject.purpose === "reference" ? subject.referenceRequestId : null,
    hr_payslip_id: subject.purpose === "payslip" ? subject.payslipId : null,
    token_hash: hashToken(token),
    expires_at: expiresAt.toISOString(),
    max_uses: opts.maxUses ?? null,
    created_reason: opts.reason ?? null,
  });
  if (error) throw new Error(error.message);
  return { token, url: `${siteUrl()}/${PREFIX[subject.purpose]}/${token}`, expiresAt };
}

export type ConsumeOutcome =
  | { outcome: "ok"; subject: MintSubject }
  | { outcome: "expired" | "revoked" | "exhausted" | "unknown" };

export async function consumeToken(
  admin: AdminClient,
  token: string,
  expected: HrTokenPurpose,
  ctx: { ipHash: string | null; userAgent: string | null }
): Promise<ConsumeOutcome> {
  if (!/^[A-Za-z0-9_-]{40,48}$/.test(token)) return { outcome: "unknown" };
  const { data, error } = await admin.rpc("hr_consume_token", {
    p_token_hash: hashToken(token),
    p_ip_hash: ctx.ipHash,
    p_user_agent: ctx.userAgent,
  });
  if (error) throw new Error(error.message);
  const row = data?.[0];
  if (!row) return { outcome: "unknown" };
  if (row.outcome !== "ok") return { outcome: row.outcome };
  // A link presented at the wrong door is refused as unknown: a reference
  // token opened at /h/ must not become an applicant session.
  if (row.purpose !== expected) return { outcome: "unknown" };
  if (expected === "application" && row.hr_application_id) {
    return { outcome: "ok", subject: { purpose: "application", applicationId: row.hr_application_id } };
  }
  if (expected === "reference" && row.hr_reference_request_id) {
    return { outcome: "ok", subject: { purpose: "reference", referenceRequestId: row.hr_reference_request_id } };
  }
  if (expected === "payslip" && row.hr_payslip_id) {
    return { outcome: "ok", subject: { purpose: "payslip", payslipId: row.hr_payslip_id } };
  }
  return { outcome: "unknown" };
}

export async function revokeApplicationTokens(admin: AdminClient, applicationId: string): Promise<void> {
  const { error } = await admin
    .from("hr_access_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("hr_application_id", applicationId)
    .is("revoked_at", null);
  if (error) throw new Error(error.message);
}

export async function revokeReferenceTokens(admin: AdminClient, referenceRequestId: string): Promise<void> {
  const { error } = await admin
    .from("hr_access_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("hr_reference_request_id", referenceRequestId)
    .is("revoked_at", null);
  if (error) throw new Error(error.message);
}
