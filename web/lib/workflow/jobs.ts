import "server-only";
import { randomUUID } from "node:crypto";
import type { AdminClient } from "@/lib/supabase/admin";
import type { ApplicationStatus, JobRow } from "@/lib/supabase/types";
import { sendTemplatedEmail } from "@/lib/email/send";
import type { JobPrecondition } from "@/lib/workflow/engine";

/**
 * The job drain.
 *
 * Claims a batch (the database hands each job to exactly one worker), checks
 * each job's precondition against the world *now*, runs it, and records the
 * outcome. Runs from `after()` at the end of any request that queued work,
 * and from the five-minute cron as the durability guarantee.
 */

export type DrainSummary = {
  worker: string;
  claimed: number;
  done: number;
  skipped: number;
  failed: number;
  errors: string[];
};

type Handler = (admin: AdminClient, job: JobRow) => Promise<
  { outcome: "done" } | { outcome: "skipped"; reason: string } | { outcome: "failed"; error: string; retryable: boolean }
>;

const HANDLERS: Record<string, Handler> = {
  async send_email(admin, job) {
    const payload = job.payload as { template_key?: string; booking_id?: string | null };
    if (!payload.template_key || !job.application_id) {
      return { outcome: "failed", error: "send_email job missing template_key or application", retryable: false };
    }
    const result = await sendTemplatedEmail(admin, {
      applicationId: job.application_id,
      templateKey: payload.template_key,
      idempotencyKey: job.idempotency_key,
      bookingId: payload.booking_id ?? null,
    });
    if (result.status === "sent") return { outcome: "done" };
    if (result.status === "skipped") return { outcome: "skipped", reason: result.reason };
    return { outcome: "failed", error: result.error, retryable: result.retryable };
  },
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

  return { holds: true };
}

/** Exponential-ish backoff: 1, 5, 25, 60, 60 minutes. */
function backoffMinutes(attempt: number): number {
  return Math.min(60, 5 ** Math.max(attempt - 1, 0));
}

export async function drainJobs(admin: AdminClient, limit = 25): Promise<DrainSummary> {
  const worker = `worker-${randomUUID().slice(0, 8)}`;
  const summary: DrainSummary = { worker, claimed: 0, done: 0, skipped: 0, failed: 0, errors: [] };

  const { data: jobs, error } = await admin.rpc("claim_jobs", { p_worker: worker, p_limit: limit });
  if (error) throw new Error(error.message);
  summary.claimed = jobs?.length ?? 0;

  for (const job of jobs ?? []) {
    try {
      const pre = await preconditionHolds(admin, job.application_id, job.precondition as JobPrecondition | null);
      if (!pre.holds) {
        await admin
          .from("jobs")
          .update({ status: "skipped", last_error: pre.reason, completed_at: new Date().toISOString() })
          .eq("id", job.id);
        summary.skipped += 1;
        continue;
      }

      const handler = HANDLERS[job.type];
      if (!handler) {
        await admin
          .from("jobs")
          .update({ status: "failed", last_error: `No handler for ${job.type}`, completed_at: new Date().toISOString() })
          .eq("id", job.id);
        summary.failed += 1;
        summary.errors.push(`${job.id}: no handler for ${job.type}`);
        continue;
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
        const exhausted = !result.retryable || job.attempts >= job.max_attempts;
        await admin
          .from("jobs")
          .update(
            exhausted
              ? { status: "failed", last_error: result.error, completed_at: new Date().toISOString() }
              : {
                  status: "pending",
                  last_error: result.error,
                  run_after: new Date(Date.now() + backoffMinutes(job.attempts) * 60_000).toISOString(),
                  locked_at: null,
                  locked_by: null,
                }
          )
          .eq("id", job.id);
        summary.failed += 1;
        summary.errors.push(`${job.id}: ${result.error}`);
      }
    } catch (e) {
      const message = (e as Error).message;
      const exhausted = job.attempts >= job.max_attempts;
      await admin
        .from("jobs")
        .update(
          exhausted
            ? { status: "failed", last_error: message, completed_at: new Date().toISOString() }
            : {
                status: "pending",
                last_error: message,
                run_after: new Date(Date.now() + backoffMinutes(job.attempts) * 60_000).toISOString(),
                locked_at: null,
                locked_by: null,
              }
        )
        .eq("id", job.id);
      summary.failed += 1;
      summary.errors.push(`${job.id}: ${message}`);
    }
  }

  return summary;
}
