import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";

/**
 * The HR job types. Every one is safe to run twice: its idempotency key
 * makes a second enqueue a no-op, and its precondition is checked against
 * the database immediately before it runs, so a reminder queued for a
 * reference that has since arrived is skipped rather than sent.
 */
export type JobSpec =
  | { type: "send_email"; payload: SendEmailPayload }
  | { type: "reference_send"; payload: { reference_request_id: string } }
  | { type: "reference_remind"; payload: { reference_request_id: string; final: boolean } }
  | { type: "reference_expire"; payload: { reference_request_id: string } }
  | { type: "ai_mark_application"; payload: { application_id: string } }
  | { type: "ai_integrity_check"; payload: { application_id: string } }
  | { type: "score_recompute"; payload: { application_id: string } }
  | { type: "interview_email"; payload: { interview_id: string; kind: "invite" | "changed" | "cancelled" } }
  | { type: "payslip_send"; payload: { payslip_id: string } }
  | { type: "leave_decision_email"; payload: { leave_request_id: string } }
  | { type: "staff_alert"; payload: { key: string; application_id: string; vars: Record<string, string>; permission: string } };

export type SendEmailPayload = {
  key: string;
  to: string;
  vars: Record<string, string | null>;
  application_id?: string | null;
  reference_request_id?: string | null;
  employee_id?: string | null;
};

/** Checked by the drain against the database just before a job runs. */
export type Precondition = {
  application_status?: string[];
  application_stage?: string[];
  application_id?: string;
  reference_request_id?: string;
  reference_request_status?: string[];
};

export type Enqueue = JobSpec & {
  key: string;
  runAfter?: Date;
  precondition?: Precondition;
  maxAttempts?: number;
};

export async function enqueue(admin: AdminClient, jobs: readonly Enqueue[]): Promise<void> {
  if (!jobs.length) return;
  const { error } = await admin.from("hr_jobs").upsert(
    jobs.map((j) => ({
      type: j.type,
      payload: j.payload as unknown as Json,
      idempotency_key: j.key,
      run_after: (j.runAfter ?? new Date()).toISOString(),
      precondition: (j.precondition ?? null) as Json,
      max_attempts: j.maxAttempts ?? 5,
    })),
    { onConflict: "idempotency_key", ignoreDuplicates: true }
  );
  if (error) throw new Error(`Could not queue work: ${error.message}`);
}

export function daysFrom(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 86_400_000);
}
