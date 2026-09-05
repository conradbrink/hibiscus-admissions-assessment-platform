import { timingSafeEqual } from "node:crypto";
import { reconcileProcessingPayments } from "@/lib/payments/reconcile";
import { createAdminClient } from "@/lib/supabase/admin";
import { drainJobs } from "@/lib/workflow/jobs";
import { pruneRateLimits, sweepUnroutedEnquiries } from "@/lib/workflow/maintenance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The cron entry point (vercel.json: every five minutes). Vercel sends
 * `Authorization: Bearer $CRON_SECRET`; anything else is refused. This is
 * the durability guarantee behind the `after()` drains — if every one of
 * those failed, nothing would be more than five minutes late.
 */
function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!authorised(request)) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }
  const admin = createAdminClient();
  const routed = await sweepUnroutedEnquiries(admin);
  // Ask the gateway about payments still processing: the confirmation path
  // for a parent who paid and closed the browser, since DPO does not call us.
  const reconciled = await reconcileProcessingPayments(admin).catch((e) => {
    console.error("[payments] sweep failed", e);
    return -1;
  });
  const summary = await drainJobs(admin, 50);
  const pruned = await pruneRateLimits(admin);
  return Response.json({ ...summary, routed_enquiries: routed, reconciled_payments: reconciled, pruned_rate_limits: pruned });
}
