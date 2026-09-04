import "server-only";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";

export const FUNNEL_COOKIE = "hbs_fs";

/** The anonymous funnel session key, creating it if this is first contact. */
export async function funnelSessionKey(): Promise<string> {
  const store = await cookies();
  const existing = store.get(FUNNEL_COOKIE)?.value;
  if (existing && /^[a-f0-9-]{36}$/.test(existing)) return existing;
  const key = randomUUID();
  try {
    store.set(FUNNEL_COOKIE, key, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24,
    });
  } catch {
    // Server components cannot set cookies; the beacon route will.
  }
  return key;
}
