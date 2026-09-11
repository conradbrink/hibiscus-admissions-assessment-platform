import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request";
import { getSettings } from "@/lib/settings";
import { consumeToken } from "@/lib/tokens";
import { startFamilySession, startParentSession } from "@/lib/tokens/server";

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

  // Which subject the token named decides which cookie is written and which
  // half of the product the parent lands in. The two never mix: a family
  // link cannot open a funnel page, and a funnel link cannot open the hub.
  if (result.familyId !== null) {
    await startFamilySession(result.familyId, result.purpose, settings.familySessionMinutes);
    if (result.purpose === "onboarding") redirect("/family/checklist");
    if (result.purpose === "reenrolment") redirect("/family/returning");
    if (result.purpose === "checkin") redirect("/family/check-in");
    if (result.purpose === "event") redirect("/family/dates");
    redirect("/family");
  }
  // The database allows only the two, and `consumeToken` refuses a row that
  // names neither; this is the belt to that pair of braces.
  if (result.applicationId === null) redirect("/link?reason=unknown");

  await startParentSession(result.applicationId, result.purpose, settings.parentSessionMinutes);

  // The link says what it is for; the page it lands on checks the data is
  // there (a profile that is not published, an offer that is not sent) and
  // otherwise the hub shows the one next step.
  if (result.purpose === "results") redirect("/profile");
  if (result.purpose === "offer") redirect("/offer");
  if (result.purpose === "payment") redirect("/pay");
  if (result.purpose === "registration") redirect("/register");
  redirect("/next");
}
