import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { AdminClient } from "@/lib/supabase/admin";
import type { TokenPurpose } from "@/lib/supabase/types";

/**
 * Magic links.
 *
 * A token is 32 bytes from the CSPRNG, base64url — 256 bits, which is more
 * entropy than the session secret protecting it. Only its SHA-256 hash is
 * stored. The link is `/a/<token>`; the route exchanges it once for a scoped
 * cookie (see ./session.ts) and redirects to a clean URL, so the token is in
 * a browser's address bar for one request and in its history never.
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

export function linkFor(token: string): string {
  return `${siteUrl()}/a/${token}`;
}

/**
 * Exactly one subject, and the purpose has to agree with it — the database
 * says so too, in `access_tokens_subject_check`. A union rather than two
 * optional ids so a caller cannot forget to name one.
 */
export type MintSubject = { applicationId: string } | { familyId: string };

export type MintOptions = MintSubject & {
  purpose: TokenPurpose;
  ttlDays: number;
  /** Null: unlimited uses inside the expiry. */
  maxUses?: number | null;
  reason?: string;
};

/** Creates a token and returns the one-time-visible raw value and its URL. */
export async function mintToken(
  admin: AdminClient,
  opts: MintOptions
): Promise<{ token: string; url: string; expiresAt: Date; id: string }> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + opts.ttlDays * 86_400_000);
  const { data, error } = await admin
    .from("access_tokens")
    .insert({
      application_id: "applicationId" in opts ? opts.applicationId : null,
      family_id: "familyId" in opts ? opts.familyId : null,
      purpose: opts.purpose,
      token_hash: hashToken(token),
      expires_at: expiresAt.toISOString(),
      max_uses: opts.maxUses ?? null,
      created_reason: opts.reason ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create link");
  return { token, url: linkFor(token), expiresAt, id: data.id };
}

export type ConsumeOutcome =
  | { outcome: "ok"; applicationId: string; familyId: null; purpose: TokenPurpose; tokenId: string }
  | { outcome: "ok"; applicationId: null; familyId: string; purpose: TokenPurpose; tokenId: string }
  | { outcome: "expired" | "revoked" | "exhausted" | "unknown" };

/** Verifies and consumes a raw token. Atomic in the database. */
export async function consumeToken(
  admin: AdminClient,
  token: string,
  ctx: { ipHash: string | null; userAgent: string | null }
): Promise<ConsumeOutcome> {
  // Anything that is not the shape we mint is "unknown" without a round
  // trip. Also bounds the hash input.
  if (!/^[A-Za-z0-9_-]{40,48}$/.test(token)) return { outcome: "unknown" };

  const { data, error } = await admin.rpc("consume_token_v2", {
    p_token_hash: hashToken(token),
    p_ip_hash: ctx.ipHash,
    p_user_agent: ctx.userAgent,
  });
  if (error) throw new Error(error.message);
  const row = data?.[0];
  const refused = (): ConsumeOutcome => {
    const outcome = row?.outcome;
    return {
      outcome:
        outcome === "expired" || outcome === "revoked" || outcome === "exhausted"
          ? outcome
          : "unknown",
    };
  };
  if (!row || row.outcome !== "ok" || !row.purpose || !row.token_id) return refused();

  // The database guarantees exactly one subject, but a token that somehow
  // names neither is refused rather than trusted.
  if (row.family_id) {
    return {
      outcome: "ok",
      applicationId: null,
      familyId: row.family_id,
      purpose: row.purpose,
      tokenId: row.token_id,
    };
  }
  if (row.application_id) {
    return {
      outcome: "ok",
      applicationId: row.application_id,
      familyId: null,
      purpose: row.purpose,
      tokenId: row.token_id,
    };
  }
  return refused();
}

/** Revokes every live token for a family, or only those of one purpose. */
export async function revokeFamilyTokens(
  admin: AdminClient,
  familyId: string,
  purpose?: TokenPurpose
): Promise<number> {
  let q = admin
    .from("access_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("family_id", familyId)
    .is("revoked_at", null);
  if (purpose) q = q.eq("purpose", purpose);
  const { data, error } = await q.select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/** Revokes every live token for an application, or only those of one purpose. */
export async function revokeTokens(
  admin: AdminClient,
  applicationId: string,
  purpose?: TokenPurpose
): Promise<number> {
  let q = admin
    .from("access_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("application_id", applicationId)
    .is("revoked_at", null);
  if (purpose) q = q.eq("purpose", purpose);
  const { data, error } = await q.select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}
