import type { TransportBookingStatus } from "@/lib/supabase/types";

/** A booking's status, in the words and colours the staff screens use. */
export const BOOKING_STATUS_LABELS: Record<TransportBookingStatus, string> = {
  awaiting_payment: "Awaiting payment",
  paid: "Paid",
  cancelled: "Cancelled",
  expired: "Expired",
  abandoned: "Abandoned",
};

export const BOOKING_STATUS_TONE: Record<TransportBookingStatus, "warning" | "success" | "muted"> = {
  awaiting_payment: "warning",
  paid: "success",
  cancelled: "muted",
  expired: "muted",
  abandoned: "muted",
};

export function isBookingStatus(v: string | undefined): v is TransportBookingStatus {
  return v !== undefined && Object.hasOwn(BOOKING_STATUS_LABELS, v);
}
