import { NextResponse } from "next/server";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request";
import { markOpened } from "@/lib/references";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeToken } from "@/lib/tokens";
import { startRefereeSession } from "@/lib/tokens/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A referee's emailed link, exchanged once for the referee cookie. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const admin = createAdminClient();
  const ctx = await requestContext();
  const to = (path: string) => NextResponse.redirect(new URL(path, request.url), 303);
  const verdict = await enforceRateLimit(admin, LIMITS.tokenResolve, `ip:${ctx.ipHash ?? "unknown"}`);
  if (!verdict.ok) return to("/reference/expired?busy=1");
  const result = await consumeToken(admin, token, "reference", ctx);
  if (result.outcome !== "ok" || result.subject.purpose !== "reference") return to("/reference/expired");
  await startRefereeSession(result.subject.referenceRequestId);
  await markOpened(admin, result.subject.referenceRequestId);
  return to("/reference");
}
