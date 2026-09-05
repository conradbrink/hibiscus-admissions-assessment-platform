import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { JobRow } from "@/lib/supabase/types";
import { sendTemplatedEmail, type LinkPurpose } from "@/lib/email/send";
import type { HandlerResult } from "@/lib/workflow/handlers";

const LINK_PURPOSES: LinkPurpose[] = ["results", "offer"];

export async function sendEmailHandler(admin: AdminClient, job: JobRow): Promise<HandlerResult> {
  const payload = job.payload as {
    template_key?: string;
    booking_id?: string | null;
    links?: string[] | null;
    offer_id?: string | null;
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
  });
  if (result.status === "sent") return { outcome: "done" };
  if (result.status === "skipped") return { outcome: "skipped", reason: result.reason };
  return { outcome: "failed", error: result.error, retryable: result.retryable };
}
