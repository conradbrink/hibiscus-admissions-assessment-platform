import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";

/**
 * Rate limits for the HR app's public pages, counted in Postgres by the
 * shared `consume_rate_limit` (serverless instances cannot count in memory).
 * The buckets are prefixed `hr_` so they never share a count with admissions.
 */

export type Limit = { bucket: string; limit: number; windowSeconds: number };

export const LIMITS = {
  /** Starting an application, per address. */
  applyStart: { bucket: "hr_apply_start", limit: 10, windowSeconds: 3600 },
  /** Starting an application, per email: stops one address being used to spam a person. */
  applyStartByEmail: { bucket: "hr_apply_start_email", limit: 5, windowSeconds: 3600 },
  /** Opening a magic link. */
  tokenResolve: { bucket: "hr_token_resolve", limit: 30, windowSeconds: 600 },
  /** Asking for a fresh link. */
  freshLinkByIp: { bucket: "hr_fresh_link_ip", limit: 10, windowSeconds: 3600 },
  freshLinkByEmail: { bucket: "hr_fresh_link_email", limit: 3, windowSeconds: 3600 },
  /** Autosaving a section of the form, per application. */
  applySave: { bucket: "hr_apply_save", limit: 400, windowSeconds: 3600 },
  /** Uploading a document, per application. */
  documentUpload: { bucket: "hr_document_upload", limit: 30, windowSeconds: 3600 },
  /** Submitting a reference, per request. */
  referenceSubmit: { bucket: "hr_reference_submit", limit: 10, windowSeconds: 3600 },
  /** Asking the AI to draft questions, per person. Each is a model call. */
  aiDraft: { bucket: "hr_ai_draft", limit: 30, windowSeconds: 3600 },
} satisfies Record<string, Limit>;

export type Verdict = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * Fails open on a counting error, because losing the counter is a worse
 * reason to stop a teacher applying than letting a few through uncounted;
 * `strict` fails closed for actions whose only guard is the quota.
 */
export async function enforceRateLimit(
  admin: AdminClient,
  limit: Limit,
  subject: string,
  opts: { strict?: boolean } = {}
): Promise<Verdict> {
  const { data, error } = await admin.rpc("consume_rate_limit", {
    p_bucket: limit.bucket,
    p_subject: subject,
    p_limit: limit.limit,
    p_window_seconds: limit.windowSeconds,
    p_cost: 1,
  });
  if (error) {
    console.error(`[rate-limit] ${limit.bucket} could not be counted: ${error.message}`);
    return opts.strict ? { ok: false, retryAfterSeconds: 30 } : { ok: true };
  }
  const v = data as { allowed: boolean; retry_after_seconds: number };
  if (v.allowed) return { ok: true };
  return { ok: false, retryAfterSeconds: Math.max(v.retry_after_seconds, 1) };
}
