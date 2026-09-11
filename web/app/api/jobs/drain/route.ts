import { timingSafeEqual } from "node:crypto";
import { reconcileProcessingPayments } from "@/lib/payments/reconcile";
import { createAdminClient } from "@/lib/supabase/admin";
import { drainJobs } from "@/lib/workflow/jobs";
import { queueDigests } from "@/lib/workflow/automation/digest";
import { sweepOnboarding } from "@/lib/workflow/automation/onboarding";
import { sweepReenrolment } from "@/lib/workflow/automation/reenrolment";
import { anonymiseExpired } from "@/lib/workflow/automation/retention";
import { ensureWeekdaySessions } from "@/lib/workflow/automation/sessions";
import { promoteWaitlist } from "@/lib/workflow/automation/waitlist";
import { pruneDrainRuns, pruneRateLimits, sweepUnroutedEnquiries } from "@/lib/workflow/maintenance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The scheduled entry point. Whoever calls it sends
 * `Authorization: Bearer $CRON_SECRET`; anything else is refused.
 *
 * Three things call it, deliberately, at three cadences: Supabase's `pg_cron`
 * every five minutes (the real schedule — the database is the one part of
 * this system that is always awake), the GitHub Actions workflow hourly as a
 * backstop, and Vercel's own cron nightly as a last resort. The drain is
 * idempotent — `claim_jobs` hands each job to one worker and the session
 * generator upserts — so an overlap costs nothing.
 *
 * This is the durability guarantee behind the `after()` drains: if every one
 * of those failed, nothing would be more than five minutes late. Every run
 * leaves a row in `drain_runs`, because for months this endpoint was being
 * called once every three and a half hours and nothing said so.
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
  const reenrolment = await sweepReenrolment(admin).catch((e) => {
    console.error("[reenrolment] sweep failed", e);
    return { asked: -1, chased: -1 };
  });
  const onboarding = await sweepOnboarding(admin).catch((e) => {
    console.error("[onboarding] sweep failed", e);
    return { sent: -1, skipped: -1, tasks: -1 };
  });
  const sessionsCreated = await ensureWeekdaySessions(admin).catch((e) => {
    console.error("[sessions] weekday schedule failed", e);
    return -1;
  });
  // The sweeps above are this endpoint's own work and are not visible in the
  // queue's counters, so they ride along on the drain's record — otherwise a
  // run that created 48 sittings and promoted a waitlist would be filed as
  // having done nothing.
  const detail = {
    routed_enquiries: routed,
    reenrolment,
    onboarding,
    reconciled_payments: reconciled,
    waitlist_promoted: waitlist.promoted,
    waitlist_tasks: waitlist.tasks,
    retention_anonymised: retention.anonymised,
    digests_queued: digests,
    sessions_created: sessionsCreated,
  };
  const summary = await drainJobs(admin, 50, { source: "schedule", detail });
  const [pruned, prunedRuns] = await Promise.all([pruneRateLimits(admin), pruneDrainRuns(admin)]);
  return Response.json({
    ...summary,
    ...detail,
    pruned_rate_limits: pruned,
    pruned_drain_runs: prunedRuns,
  });
}
