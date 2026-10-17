import "server-only";
import { sendTransportEmail } from "@/lib/email/send";
import { formatDateRange } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import type { AdminClient } from "@/lib/supabase/admin";
import type { JobRow } from "@/lib/supabase/types";
import { SERVICE_LABELS, weekdaysLabel } from "@/lib/transport/days";
import { renderTransportReceipt } from "@/lib/transport/receipt";
import { loadTransportBooking } from "@/lib/transport/scope";
import type { HandlerResult } from "@/lib/workflow/handlers";

/**
 * `send_transport_email`: an email to the person who made a booking, queued
 * by the settlement (`lib/transport/settle.ts`). The paid email carries the
 * receipt; every variable is built here from the booking's own rows, so the
 * email says what the database says.
 */
export async function sendTransportEmailHandler(admin: AdminClient, job: JobRow): Promise<HandlerResult> {
  const payload = (job.payload ?? {}) as { transport_booking_id?: string; template_key?: string };
  if (!payload.transport_booking_id || !payload.template_key) {
    return { outcome: "failed", error: "send_transport_email needs a booking and a template", retryable: false };
  }

  const loaded = await loadTransportBooking(admin, payload.transport_booking_id);
  if (!loaded) return { outcome: "skipped", reason: "the booking no longer exists" };
  const settings = await getSettings(admin);
  const { booking, period, riders, request } = loaded;

  const children = riders
    .filter((r) => r.status === "booked")
    .map((r) => `${r.first_name} ${r.last_name} (${r.campus?.name ?? "school"}): ${SERVICE_LABELS[r.service].toLowerCase()}, ${weekdaysLabel(r)}`)
    .join("; ");

  const attachments = [];
  if (payload.template_key === "transport_paid") {
    const receipt = await renderTransportReceipt(loaded);
    if (receipt) attachments.push({ filename: receipt.filename, content: receipt.bytes, contentType: "application/pdf" });
  }

  const result = await sendTransportEmail(admin, {
    bookingId: booking.id,
    templateKey: payload.template_key,
    idempotencyKey: job.idempotency_key,
    attachments,
    variables: {
      booking_reference: booking.reference,
      period: period?.label ?? "",
      period_dates: period ? formatDateRange(period.starts_on, period.ends_on) : "",
      children,
      amount_paid: request ? formatMoney(Number(request.paid_minor), request.currency) : "",
      office_contact: settings.transportOfficeContact || "the school office",
    },
  });
  if (result.status === "sent") return { outcome: "done" };
  if (result.status === "skipped") return { outcome: "skipped", reason: result.reason };
  return { outcome: "failed", error: result.error, retryable: result.retryable };
}
