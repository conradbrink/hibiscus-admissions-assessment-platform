import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { JobRow } from "@/lib/supabase/types";
import { expireAttemptHandler, markAttemptHandler } from "@/lib/workflow/handlers/assessment";
import {
  evaluateAdmissionHandler,
  generateProfileHandler,
  sendOutcomeHandler,
  suggestWritingBandHandler,
} from "@/lib/workflow/handlers/decisions";
import { draftOfferHandler, offerExpireHandler } from "@/lib/workflow/handlers/offers";
import { paymentOverdueHandler, paymentVerifyHandler } from "@/lib/workflow/handlers/payments";
import { autoEnrolHandler } from "@/lib/workflow/handlers/registration";
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

export const HANDLERS: Record<string, Handler> = {
  send_email: sendEmailHandler,
  mark_attempt: markAttemptHandler,
  expire_attempt: expireAttemptHandler,
  suggest_writing_band: suggestWritingBandHandler,
  evaluate_admission: evaluateAdmissionHandler,
  generate_learning_profile: generateProfileHandler,
  send_outcome: sendOutcomeHandler,
  draft_offer: draftOfferHandler,
  offer_expire: offerExpireHandler,
  payment_verify: paymentVerifyHandler,
  payment_overdue: paymentOverdueHandler,
  auto_enrol: autoEnrolHandler,
};
