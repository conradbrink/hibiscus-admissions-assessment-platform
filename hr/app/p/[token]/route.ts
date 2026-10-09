import { NextResponse } from "next/server";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeToken } from "@/lib/tokens";
import { startPayslipSession } from "@/lib/tokens/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** An employee's emailed payslip link, exchanged for a short cookie that opens that one payslip. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const admin = createAdminClient();
  const ctx = await requestContext();
  const to = (path: string) => NextResponse.redirect(new URL(path, request.url), 303);
  const verdict = await enforceRateLimit(admin, LIMITS.tokenResolve, `ip:${ctx.ipHash ?? "unknown"}`);
  if (!verdict.ok) return to("/payslip/expired?busy=1");
  const result = await consumeToken(admin, token, "payslip", ctx);
  if (result.outcome !== "ok" || result.subject.purpose !== "payslip") return to("/payslip/expired");
  await startPayslipSession(result.subject.payslipId);
  return to("/payslip");
}
