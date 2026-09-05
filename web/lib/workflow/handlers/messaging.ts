import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { JobRow } from "@/lib/supabase/types";
import { sendCompanionMessage } from "@/lib/messaging/send";
import type { HandlerResult } from "@/lib/workflow/handlers";

/** The WhatsApp companion of an email that went. Queued by the email handler, never by an action. */
export async function sendWhatsAppHandler(admin: AdminClient, job: JobRow): Promise<HandlerResult> {
  const payload = job.payload as {
    template_key?: string;
    email_message_id?: string | null;
    offer_id?: string | null;
    payment_request_id?: string | null;
    payment_id?: string | null;
    missing_documents?: string | null;
  };
  if (!payload.template_key || !job.application_id) {
    return { outcome: "failed", error: "send_whatsapp job missing template_key or application", retryable: false };
  }
  const result = await sendCompanionMessage(admin, {
    applicationId: job.application_id,
    templateKey: payload.template_key,
    idempotencyKey: job.idempotency_key,
    emailMessageId: payload.email_message_id ?? null,
    offerId: payload.offer_id ?? null,
    paymentRequestId: payload.payment_request_id ?? null,
    paymentId: payload.payment_id ?? null,
    missingDocuments: payload.missing_documents ?? null,
    trigger: "companion",
  });
  if (result.status === "sent") return { outcome: "done" };
  if (result.status === "skipped") return { outcome: "skipped", reason: result.reason };
  return { outcome: "failed", error: result.error, retryable: result.retryable };
}
