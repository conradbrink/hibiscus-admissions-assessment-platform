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

export type MintOptions = {
  applicationId: string;
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
      application_id: opts.applicationId,
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
  | { outcome: "ok"; applicationId: string; purpose: TokenPurpose; tokenId: string }
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

  const { data, error } = await admin.rpc("consume_token", {
    p_token_hash: hashToken(token),
    p_ip_hash: ctx.ipHash,
    p_user_agent: ctx.userAgent,
  });
  if (error) throw new Error(error.message);
  const row = data?.[0];
  if (!row || row.outcome !== "ok" || !row.application_id || !row.purpose || !row.token_id) {
    const outcome = row?.outcome;
    return {
      outcome:
        outcome === "expired" || outcome === "revoked" || outcome === "exhausted"
          ? outcome
          : "unknown",
    };
  }
  return {
    outcome: "ok",
    applicationId: row.application_id,
    purpose: row.purpose,
    tokenId: row.token_id,
  };
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
