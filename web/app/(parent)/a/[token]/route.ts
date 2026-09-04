import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request";
import { getSettings } from "@/lib/settings";
import { consumeToken } from "@/lib/tokens";
import { startParentSession } from "@/lib/tokens/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The magic-link landing. Exchanges the token in the path for a scoped
 * cookie and redirects to a clean URL, so the token is in the address bar
 * for this one request and in browser history never.
 *
 * Every failure lands on /link with a reason it can explain, never a blank
 * error: the parent who opens a fortnight-old email must be told what to do.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const ctx = await requestContext();

  const verdict = await enforceRateLimit(admin, LIMITS.tokenResolve, ctx.ipHash ?? "unknown");
  if (!verdict.ok) redirect("/link?reason=busy");

  const result = await consumeToken(admin, token, ctx);
  if (result.outcome !== "ok") redirect(`/link?reason=${result.outcome}`);

  const settings = await getSettings(admin);
  await startParentSession(result.applicationId, result.purpose, settings.parentSessionMinutes);

  // Purpose-specific destinations arrive with later phases (results, offer,
  // payment, registration). Everything currently lands on the hub, which
  // shows the one next step.
  redirect("/next");
}
