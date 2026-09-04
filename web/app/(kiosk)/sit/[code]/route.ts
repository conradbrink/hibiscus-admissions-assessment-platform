import { redirect } from "next/navigation";
import { consumeKioskCode, openAttemptSession } from "@/lib/assessment/kiosk-server";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The QR code's target. Same exchange as typing the code, then a redirect
 * to a clean URL: the code is in the address bar for one request. It is
 * single use, so the URL is worthless once it has been followed, and
 * lib/monitoring.ts masks this path in error reports.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const admin = createAdminClient();
  const ctx = await requestContext();

  const verdict = await enforceRateLimit(admin, LIMITS.kioskCode, ctx.ipHash ?? "unknown");
  if (!verdict.ok) redirect("/sit?reason=invalid");

  const result = await consumeKioskCode(admin, code);
  if (!result.ok) redirect("/sit?reason=invalid");

  const settings = await getSettings(admin);
  const opened = await openAttemptSession(admin, result.attemptId, ctx.userAgent, settings.attemptGraceSeconds);
  if (!opened.ok) redirect("/sit?reason=invalid");

  redirect("/sit/assessment");
}
