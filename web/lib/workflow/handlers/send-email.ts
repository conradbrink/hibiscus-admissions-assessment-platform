import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { JobRow } from "@/lib/supabase/types";
import { sendFamilyEmail, sendTemplatedEmail, type FamilyLinkPurpose, type LinkPurpose } from "@/lib/email/send";
import { sendFamilyMessage } from "@/lib/messaging/send";
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
    outstanding_items?: string | null;
    all_received?: boolean | null;
    /** A family moment names these instead of an application. */
    family_id?: string | null;
    student_id?: string | null;
    family_link?: FamilyLinkPurpose | null;
    variables?: Record<string, string | null>;
  };
  if (!payload.template_key) {
    return { outcome: "failed", error: "send_email job missing template_key", retryable: false };
  }

  // A family moment: the re-enrolment ask and everything after it. One job
  // type, so the drain's backoff, idempotency and the WhatsApp companion are
  // the same machinery for both halves of the product.
  if (payload.family_id) {
    const result = await sendFamilyEmail(admin, {
      familyId: payload.family_id,
      studentId: payload.student_id ?? null,
      templateKey: payload.template_key,
      idempotencyKey: job.idempotency_key,
      link: payload.family_link ?? null,
      variables: payload.variables ?? {},
    });
    if (result.status === "skipped") return { outcome: "skipped", reason: result.reason };
    if (result.status === "failed") return { outcome: "failed", error: result.error, retryable: result.retryable };

    const settings = await getSettings(admin);
    if (settings.whatsappEnabled) {
      // Sent inline rather than queued as a second job: it has no application
      // to hang one on, and `enqueueJobs` keys work by application. The
      // idempotency key is still the email's, so a retried email cannot
      // produce a second message.
      await sendFamilyMessage(admin, {
        familyId: payload.family_id,
        studentId: payload.student_id ?? null,
        templateKey: payload.template_key,
        idempotencyKey: `whatsapp:${job.idempotency_key}`,
        emailMessageId: result.messageId,
        variables: payload.variables ?? {},
        link: payload.family_link ?? null,
      });
    }
    return { outcome: "done" };
  }

  if (!job.application_id) {
    return { outcome: "failed", error: "send_email job missing application", retryable: false };
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
    outstandingItems: payload.outstanding_items ?? null,
    allReceived: payload.all_received ?? false,
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
