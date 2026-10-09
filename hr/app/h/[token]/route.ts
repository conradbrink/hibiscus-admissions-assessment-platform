import { NextResponse } from "next/server";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeToken } from "@/lib/tokens";
import { startApplicantSession } from "@/lib/tokens/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * An applicant's emailed link. Exchanged once for the applicant cookie, then
 * a redirect to a clean address, so the token is in the address bar for one
 * request and in the history never.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const admin = createAdminClient();
  const ctx = await requestContext();
  const verdict = await enforceRateLimit(admin, LIMITS.tokenResolve, `ip:${ctx.ipHash ?? "unknown"}`);
  const to = (path: string) => NextResponse.redirect(new URL(path, request.url), 303);
  if (!verdict.ok) return to("/apply/link?busy=1");
  const result = await consumeToken(admin, token, "application", ctx);
  if (result.outcome !== "ok" || result.subject.purpose !== "application") return to("/apply/link?expired=1");
  await startApplicantSession(result.subject.applicationId);
  return to("/apply");
}
