import { timingSafeEqual } from "node:crypto";
import { reconcileProcessingPayments } from "@/lib/payments/reconcile";
import { createAdminClient } from "@/lib/supabase/admin";
import { drainJobs } from "@/lib/workflow/jobs";
import { queueDigests } from "@/lib/workflow/automation/digest";
import { anonymiseExpired } from "@/lib/workflow/automation/retention";
import { promoteWaitlist } from "@/lib/workflow/automation/waitlist";
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
  // Phase 4 automation. Each is gated by its setting and idempotent; a
  // failure in one is logged and does not stop the others.
  const waitlist = await promoteWaitlist(admin).catch((e) => {
    console.error("[waitlist] sweep failed", e);
    return { promoted: -1, tasks: -1 };
  });
  const retention = await anonymiseExpired(admin).catch((e) => {
    console.error("[retention] run failed", e);
    return { anonymised: -1, failed: -1, skipped: "error" };
  });
  const digests = await queueDigests(admin).catch((e) => {
    console.error("[digest] queue failed", e);
    return -1;
  });
  const summary = await drainJobs(admin, 50);
  const pruned = await pruneRateLimits(admin);
  return Response.json({
    ...summary,
    routed_enquiries: routed,
    reconciled_payments: reconciled,
    pruned_rate_limits: pruned,
    waitlist_promoted: waitlist.promoted,
    waitlist_tasks: waitlist.tasks,
    retention_anonymised: retention.anonymised,
    digests_queued: digests,
  });
}
