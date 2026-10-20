"use server";

import { redirect } from "next/navigation";
import type { TransportFormState } from "@/components/parent/transport-booking-form";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request";
import { getSettings } from "@/lib/settings";
import { startTransportSession } from "@/lib/tokens/server";
import { bookingErrorMessage, isKnownBookingError } from "@/lib/transport/errors";
import { parseTransportBooking } from "@/lib/transport/form";
import { startTransportBooking, transportClient, TransportBookingError } from "@/lib/transport/scope";

function valuesOf(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

/**
 * The booking form's submit. Checked here for shape, then created and priced
 * by the database, then the browser is given a session for that one booking
 * and sent to pay. Nothing the form says about money is read — there is no
 * such field — and the database refuses anything this let through that it
 * should not have.
 */
export async function submitTransportBooking(_state: TransportFormState, formData: FormData): Promise<TransportFormState> {
  const values = valuesOf(formData);
  const admin = transportClient();
  const ctx = await requestContext();

  // Checked before either limit is spent, as /join does: a parent correcting
  // a long form, or a household of them behind one school Wi-Fi, is not a
  // flood.
  const parsed = parseTransportBooking(values);
  if (!parsed.ok) return { fields: parsed.fields, error: "Please check the highlighted answers.", values };

  const byIp = await enforceRateLimit(admin, LIMITS.transportBooking, ctx.ipHash ?? "unknown");
  if (!byIp.ok) return { error: "Too many bookings from this connection. Please wait a little and try again.", values };

  const byEmail = await enforceRateLimit(admin, LIMITS.transportBookingEmail, parsed.value.emailNormalised);
  if (!byEmail.ok) return { error: "Too many bookings for this email address. Please wait a little and try again.", values };

  let bookingId: string;
  try {
    bookingId = await startTransportBooking(admin, parsed.value, { ipHash: ctx.ipHash, userAgent: ctx.userAgent });
  } catch (e) {
    const code = e instanceof TransportBookingError ? e.code : (e as Error).message;
    if (!isKnownBookingError(code)) console.error("[transport] booking failed", code);
    return { error: bookingErrorMessage(code), values };
  }

  const settings = await getSettings(admin);
  await startTransportSession(bookingId, settings.transportSessionMinutes);
  redirect("/transport/booking");
}
