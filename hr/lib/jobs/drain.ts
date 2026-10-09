import "server-only";
import { randomUUID } from "node:crypto";
import type { AdminClient } from "@/lib/supabase/admin";
import type { HrJobRow, Json } from "@/lib/supabase/types";
import { HANDLERS, PermanentJobError } from "@/lib/jobs/handlers";
import type { JobSpec, Precondition } from "@/lib/jobs/queue";

/**
 * The HR job drain: claim a batch (each job goes to exactly one worker), check
 * each job's precondition against the database now, run it, record the
 * outcome. Runs from `after()` at the end of any request that queued work and
 * from the five-minute schedule, which is the durability guarantee.
 *
 * Claims again until a claim comes back empty, bounded, because jobs queue
 * jobs: a referee's answer queues the rescore and the thank-you.
 */

export type DrainSummary = { worker: string; claimed: number; done: number; skipped: number; failed: number; errors: string[] };

async function preconditionHolds(admin: AdminClient, p: Precondition | null): Promise<{ holds: true } | { holds: false; reason: string }> {
  if (!p) return { holds: true };
  if (p.application_id && (p.application_status || p.application_stage)) {
    const { data, error } = await admin.from("hr_applications").select("status, stage").eq("id", p.application_id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { holds: false, reason: "application missing" };
    if (p.application_status && !p.application_status.includes(data.status)) return { holds: false, reason: `application is ${data.status}` };
    if (p.application_stage && !p.application_stage.includes(data.stage ?? "none")) return { holds: false, reason: `application is in ${data.stage}` };
  }
  if (p.reference_request_id && p.reference_request_status) {
    const { data, error } = await admin.from("hr_reference_requests").select("status").eq("id", p.reference_request_id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { holds: false, reason: "reference request missing" };
    if (!p.reference_request_status.includes(data.status)) return { holds: false, reason: `reference is ${data.status}` };
  }
  return { holds: true };
}

/** 1, 5, 25, 60, 60 minutes. */
function backoffMinutes(attempt: number): number {
  return Math.min(60, 5 ** Math.max(attempt - 1, 0));
}

async function finish(admin: AdminClient, job: HrJobRow, status: "done" | "skipped", note: string | null): Promise<void> {
  await admin
    .from("hr_jobs")
    .update({ status, last_error: note, completed_at: new Date().toISOString(), locked_at: null, locked_by: null })
    .eq("id", job.id);
}

async function retryOrFail(admin: AdminClient, job: HrJobRow, error: string, retryable: boolean): Promise<"failed" | "retry"> {
  const exhausted = !retryable || job.attempts >= job.max_attempts;
  await admin
    .from("hr_jobs")
    .update(
      exhausted
        ? { status: "failed", last_error: error, completed_at: new Date().toISOString(), locked_at: null, locked_by: null }
        : {
            status: "pending",
            last_error: error,
            run_after: new Date(Date.now() + backoffMinutes(job.attempts) * 60_000).toISOString(),
            locked_at: null,
            locked_by: null,
          }
    )
    .eq("id", job.id);
  return exhausted ? "failed" : "retry";
}

async function runOne(admin: AdminClient, job: HrJobRow): Promise<"done" | "skipped" | "failed" | "retry"> {
  const handler = HANDLERS[job.type as JobSpec["type"]] as
    | ((a: AdminClient, p: unknown, j: { id: string; idempotency_key: string }) => Promise<{ status: "done" } | { status: "skipped"; reason: string }>)
    | undefined;
  if (!handler) return retryOrFail(admin, job, `No handler for ${job.type}`, false);
  try {
    const pre = await preconditionHolds(admin, job.precondition as Precondition | null);
    if (!pre.holds) {
      await finish(admin, job, "skipped", pre.reason);
      return "skipped";
    }
    const outcome = await handler(admin, job.payload, job);
    await finish(admin, job, outcome.status, outcome.status === "skipped" ? outcome.reason : null);
    return outcome.status;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return retryOrFail(admin, job, message, !(e instanceof PermanentJobError));
  }
}

export async function drainHrJobs(admin: AdminClient, source: "schedule" | "request" | "manual", opts: { maxRounds?: number } = {}): Promise<DrainSummary> {
  const started = Date.now();
  const worker = `hr-${randomUUID().slice(0, 8)}`;
  const summary: DrainSummary = { worker, claimed: 0, done: 0, skipped: 0, failed: 0, errors: [] };
  for (let round = 0; round < (opts.maxRounds ?? 5); round++) {
    const { data: jobs, error } = await admin.rpc("hr_claim_jobs", { p_worker: worker, p_limit: 20 });
    if (error) throw new Error(error.message);
    if (!jobs?.length) break;
    summary.claimed += jobs.length;
    for (const job of jobs) {
      const result = await runOne(admin, job);
      if (result === "done") summary.done++;
      else if (result === "skipped") summary.skipped++;
      else if (result === "failed") {
        summary.failed++;
        summary.errors.push(`${job.type}: failed`);
      }
    }
  }
  if (summary.claimed > 0 || source === "schedule") {
    await admin.from("hr_drain_runs").insert({
      source,
      claimed: summary.claimed,
      done: summary.done,
      skipped: summary.skipped,
      failed: summary.failed,
      duration_ms: Date.now() - started,
      detail: summary.errors.length ? ({ errors: summary.errors.slice(0, 20) } as Json) : null,
    });
  }
  return summary;
}
