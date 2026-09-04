import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { JobRow } from "@/lib/supabase/types";
import { expireAttemptHandler, markAttemptHandler } from "@/lib/workflow/handlers/assessment";
import { sendEmailHandler } from "@/lib/workflow/handlers/send-email";

/**
 * The job registry. One entry per job type; the drain looks up `job.type`
 * here. An unknown type fails permanently and strands whatever queued it,
 * so a handler is registered in the same change as the code that queues its
 * type — never "later".
 */

export type HandlerResult =
  | { outcome: "done" }
  | { outcome: "skipped"; reason: string }
  | { outcome: "failed"; error: string; retryable: boolean };

export type Handler = (admin: AdminClient, job: JobRow) => Promise<HandlerResult>;

/**
 * Placeholders for the decision and profile jobs, which the marking step
 * queues and the next step implements. Returning a retryable failure rather
 * than "skipped" means these jobs stay in the queue (up to their retry
 * budget) and are picked up by the real handler once it is deployed, instead
 * of stranding the application silently.
 */
const notYet =
  (name: string): Handler =>
  async () => ({ outcome: "failed", error: `${name} is not available in this build yet`, retryable: true });

export const HANDLERS: Record<string, Handler> = {
  send_email: sendEmailHandler,
  mark_attempt: markAttemptHandler,
  expire_attempt: expireAttemptHandler,
  suggest_writing_band: notYet("suggest_writing_band"),
  evaluate_admission: notYet("evaluate_admission"),
  generate_learning_profile: notYet("generate_learning_profile"),
};
