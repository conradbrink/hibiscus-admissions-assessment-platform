import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { JobRow } from "@/lib/supabase/types";
import { sendTemplatedEmail, type LinkPurpose } from "@/lib/email/send";
import { getSettings } from "@/lib/settings";
import { enqueueJobs } from "@/lib/workflow/engine";
import type { HandlerResult } from "@/lib/workflow/handlers";

const LINK_PURPOSES: LinkPurpose[] = ["results", "offer", "payment", "registration"];

export async function sendEmailHandler(admin: AdminClient, job: JobRow): Promise<HandlerResult> {
  const payload = job.payload as {
    template_key?: string;
    booking_id?: string | null;
    links?: string[] | null;
    offer_id?: string | null;
    payment_request_id?: string | null;
    payment_id?: string | null;
    missing_documents?: string | null;
    mismatch_details?: string | null;
  };
  if (!payload.template_key || !job.application_id) {
    return { outcome: "failed", error: "send_email job missing template_key or application", retryable: false };
  }
  const links = (payload.links ?? []).filter((l): l is LinkPurpose => (LINK_PURPOSES as string[]).includes(l));
  const result = await sendTemplatedEmail(admin, {
    applicationId: job.application_id,
    templateKey: payload.template_key,
    idempotencyKey: job.idempotency_key,
    bookingId: payload.booking_id ?? null,
    links,
    offerId: payload.offer_id ?? null,
    paymentRequestId: payload.payment_request_id ?? null,
    paymentId: payload.payment_id ?? null,
    missingDocuments: payload.missing_documents ?? null,
    mismatchDetails: payload.mismatch_details ?? null,
  });
  if (result.status === "sent") {
    // The WhatsApp companion of this moment: one job, keyed on the email's
    // key, so a retried email cannot produce a second message. The engine's
    // actions know nothing about the channel.
    const settings = await getSettings(admin);
    if (settings.whatsappEnabled) {
      await enqueueJobs(admin, [
        {
          type: "send_whatsapp",
          applicationId: job.application_id,
          idempotencyKey: `whatsapp:${job.idempotency_key}`,
          payload: {
            template_key: payload.template_key,
            email_message_id: result.messageId,
            offer_id: payload.offer_id ?? null,
            payment_request_id: payload.payment_request_id ?? null,
            payment_id: payload.payment_id ?? null,
            missing_documents: payload.missing_documents ?? null,
          },
        },
      ]);
    }
    return { outcome: "done" };
  }
  if (result.status === "skipped") return { outcome: "skipped", reason: result.reason };
  return { outcome: "failed", error: result.error, retryable: result.retryable };
}
