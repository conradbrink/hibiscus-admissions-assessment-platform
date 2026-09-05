import "server-only";
import { randomUUID } from "node:crypto";
import type { AdminClient } from "@/lib/supabase/admin";
import type { ApplicationStatus, JobRow } from "@/lib/supabase/types";
import type { JobPrecondition } from "@/lib/workflow/engine";
import { HANDLERS } from "@/lib/workflow/handlers";

/**
 * The job drain.
 *
 * Claims a batch (the database hands each job to exactly one worker), checks
 * each job's precondition against the world *now*, runs it, and records the
 * outcome. Runs from `after()` at the end of any request that queued work,
 * and from the five-minute cron as the durability guarantee.
 *
 * Claims again until a claim comes back empty (bounded), because Phase 2
 * jobs queue jobs: marking queues the evaluation, the evaluation queues the
 * offer. Without the loop each link in that chain would wait for the next
 * drain and a submitted assessment would look stalled for five minutes.
 */

export type DrainSummary = {
  worker: string;
  claimed: number;
  done: number;
  skipped: number;
  failed: number;
  errors: string[];
};

/**
 * True when the world still matches what the job assumed. A reminder queued
 * for a booking that has since been moved fails here and is skipped.
 */
export async function preconditionHolds(
  admin: AdminClient,
  applicationId: string | null,
  precondition: JobPrecondition | null
): Promise<{ holds: true } | { holds: false; reason: string }> {
  if (!precondition) return { holds: true };

  if (precondition.application_status) {
    if (!applicationId) return { holds: false, reason: "no application" };
    const { data, error } = await admin
      .from("applications")
      .select("status")
      .eq("id", applicationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { holds: false, reason: "application missing" };
    if (!precondition.application_status.includes(data.status as ApplicationStatus)) {
      return { holds: false, reason: `application is ${data.status}` };
    }
  }

  if (precondition.booking_id) {
    const { data, error } = await admin
      .from("bookings")
      .select("status")
      .eq("id", precondition.booking_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { holds: false, reason: "booking missing" };
    if (precondition.booking_status && !precondition.booking_status.includes(data.status)) {
      return { holds: false, reason: `booking is ${data.status}` };
    }
  }

  if (precondition.attempt_id) {
    const { data, error } = await admin
      .from("attempts")
      .select("status")
      .eq("id", precondition.attempt_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { holds: false, reason: "attempt missing" };
    if (precondition.attempt_status && !precondition.attempt_status.includes(data.status)) {
      return { holds: false, reason: `attempt is ${data.status}` };
    }
  }

  if (precondition.offer_id) {
    const { data, error } = await admin
      .from("offers")
      .select("status")
      .eq("id", precondition.offer_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { holds: false, reason: "offer missing" };
    if (precondition.offer_status && !precondition.offer_status.includes(data.status)) {
      return { holds: false, reason: `offer is ${data.status}` };
    }
  }

  if (precondition.payment_id) {
    const { data, error } = await admin
      .from("payments")
      .select("status")
      .eq("id", precondition.payment_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { holds: false, reason: "payment missing" };
    if (precondition.payment_status && !precondition.payment_status.includes(data.status)) {
      return { holds: false, reason: `payment is ${data.status}` };
    }
  }

  return { holds: true };
}

/** Exponential-ish backoff: 1, 5, 25, 60, 60 minutes. */
function backoffMinutes(attempt: number): number {
  return Math.min(60, 5 ** Math.max(attempt - 1, 0));
}

async function retryOrFail(admin: AdminClient, job: JobRow, error: string, retryable: boolean): Promise<void> {
  const exhausted = !retryable || job.attempts >= job.max_attempts;
  await admin
    .from("jobs")
    .update(
      exhausted
        ? { status: "failed", last_error: error, completed_at: new Date().toISOString() }
        : {
            status: "pending",
            last_error: error,
            run_after: new Date(Date.now() + backoffMinutes(job.attempts) * 60_000).toISOString(),
            locked_at: null,
            locked_by: null,
          }
    )
    .eq("id", job.id);
}

async function runOne(admin: AdminClient, job: JobRow, summary: DrainSummary): Promise<void> {
  try {
    const pre = await preconditionHolds(admin, job.application_id, job.precondition as JobPrecondition | null);
    if (!pre.holds) {
      await admin
        .from("jobs")
        .update({ status: "skipped", last_error: pre.reason, completed_at: new Date().toISOString() })
        .eq("id", job.id);
      summary.skipped += 1;
      return;
    }

    const handler = HANDLERS[job.type];
    if (!handler) {
      await admin
        .from("jobs")
        .update({ status: "failed", last_error: `No handler for ${job.type}`, completed_at: new Date().toISOString() })
        .eq("id", job.id);
      summary.failed += 1;
      summary.errors.push(`${job.id}: no handler for ${job.type}`);
      return;
    }

    const result = await handler(admin, job);
    if (result.outcome === "done") {
      await admin
        .from("jobs")
        .update({ status: "done", completed_at: new Date().toISOString(), last_error: null })
        .eq("id", job.id);
      summary.done += 1;
    } else if (result.outcome === "skipped") {
      await admin
        .from("jobs")
        .update({ status: "skipped", last_error: result.reason, completed_at: new Date().toISOString() })
        .eq("id", job.id);
      summary.skipped += 1;
    } else {
      await retryOrFail(admin, job, result.error, result.retryable);
      summary.failed += 1;
      summary.errors.push(`${job.id}: ${result.error}`);
    }
  } catch (e) {
    const message = (e as Error).message;
    await retryOrFail(admin, job, message, true);
    summary.failed += 1;
    summary.errors.push(`${job.id}: ${message}`);
  }
}

export async function drainJobs(
  admin: AdminClient,
  limit = 25,
  opts: { maxBatches?: number } = {}
): Promise<DrainSummary> {
  const worker = `worker-${randomUUID().slice(0, 8)}`;
  const summary: DrainSummary = { worker, claimed: 0, done: 0, skipped: 0, failed: 0, errors: [] };
  const maxBatches = opts.maxBatches ?? 6;

  for (let batch = 0; batch < maxBatches; batch++) {
    const { data: jobs, error } = await admin.rpc("claim_jobs", { p_worker: worker, p_limit: limit });
    if (error) throw new Error(error.message);
    if (!jobs?.length) break;
    summary.claimed += jobs.length;
    for (const job of jobs) await runOne(admin, job, summary);
  }

  return summary;
}
