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
  // Vercel sets x-real-ip; behind other proxies the first x-forwarded-for
  // entry is the client. Neither is trusted for anything but a hash.
  const ip =
    h.get("x-real-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null;
  return {
    ip,
    ipHash: hashIp(ip),
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  };
}
