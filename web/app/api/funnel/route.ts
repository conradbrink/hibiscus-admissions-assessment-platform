import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFunnelStep, recordFunnelStep } from "@/lib/funnel";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request";

export const runtime = "nodejs";

export const FUNNEL_COOKIE = "hbs_fs";

/**
 * Receives one funnel step from the browser. The session key is a random
 * value in a cookie set here on first contact — it identifies a browser tab's
 * journey and nothing else.
 */
export async function POST(request: Request) {
  let body: { step?: unknown; elapsedMs?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 204 });
  }
  if (typeof body.step !== "string" || !isFunnelStep(body.step)) {
    return new Response(null, { status: 204 });
  }

  const admin = createAdminClient();
  const ctx = await requestContext();
  const verdict = await enforceRateLimit(admin, LIMITS.funnelEvent, ctx.ipHash ?? "unknown");
  if (!verdict.ok) return new Response(null, { status: 204 });

  const store = await cookies();
  let key = store.get(FUNNEL_COOKIE)?.value;
  if (!key || !/^[a-f0-9-]{36}$/.test(key)) {
    key = randomUUID();
    store.set(FUNNEL_COOKIE, key, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24,
    });
  }

  await recordFunnelStep(admin, {
    sessionKey: key,
    step: body.step,
    elapsedMs: typeof body.elapsedMs === "number" ? body.elapsedMs : null,
  });
  return new Response(null, { status: 204 });
}
