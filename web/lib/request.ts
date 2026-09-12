import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";

/**
 * What we keep about the requester: a salted hash of the address, and the
 * user agent. Enough to see "three attempts from the same place" in the
 * token log and to rate limit; not enough to identify anyone from the
 * database alone.
 */

function secret(): string {
  const s = process.env.PARENT_SESSION_SECRET;
  if (!s) throw new Error("PARENT_SESSION_SECRET is not set.");
  return s;
}

/** The left-most entry of a forwarded-for style header, bounded and trimmed. */
function firstAddress(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first && first.length <= 45 ? first : null;
}

export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`ip:${ip}:${secret()}`).digest("base64url").slice(0, 32);
}

export async function requestContext(): Promise<{
  ip: string | null;
  ipHash: string | null;
  userAgent: string | null;
}> {
  const h = await headers();
  // Whose address this is, in order of how much the header can be trusted.
  //
  // `x-vercel-forwarded-for` is written by the platform edge and cannot be
  // set by a caller: a client that sends one has it replaced. `x-real-ip` is
  // also the platform's on Vercel. The first `x-forwarded-for` entry is the
  // client only when something in front strips what the client sent — behind
  // a proxy that appends rather than replaces, that entry is whatever the
  // caller typed, so it is the last resort rather than the first choice.
  //
  // This matters because the address is the subject of the rate limits on
  // every public endpoint, and it is what the token log records: a spoofable
  // address is a rate limit that does not limit and an audit trail that can
  // be pointed at somebody else.
  const ip =
    firstAddress(h.get("x-vercel-forwarded-for")) ??
    firstAddress(h.get("x-real-ip")) ??
    firstAddress(h.get("x-forwarded-for")) ??
    null;
  return {
    ip,
    ipHash: hashIp(ip),
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  };
}
