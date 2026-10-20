/**
 * What a parent is told when the database refuses a booking.
 *
 * `create_transport_booking()` raises short codes (the convention the CRM
 * functions use), and nearly all of them mean the page the parent is looking
 * at is out of date: the booking window closed, the terms changed, a school
 * stopped offering a grade. Each gets one plain sentence saying what to do.
 * An unknown code gets the general one, never the raw message.
 */

const MESSAGES: Record<string, string> = {
  transport_booking_closed: "Booking for school transport is closed at the moment. Please contact the school office.",
  transport_period_not_open: "Booking for that term or month has closed. Please choose another one.",
  transport_area_not_served: "We cannot collect from that area yet. Please contact the school office.",
  transport_terms_changed: "The transport terms changed while you were booking. Please read them again and tick the box.",
  transport_mobile_required: "Enter a mobile number we can reach you on.",
  transport_campus_not_served: "The shuttle does not go to one of the schools you chose. Please contact the school office.",
  transport_grade_not_at_campus: "One of the grades you chose is not taught at that school. Please check each child's school and grade.",
  transport_service_invalid: "Choose a service for each child.",
  transport_days_required: "Choose at least one day for each child.",
  transport_riders_count: "Add between one and six children.",
  transport_riders_invalid: "Add between one and six children.",
  transport_no_tariff: "We could not find a price for this booking. Please contact the school office.",
};

const FALLBACK = "We could not take this booking. Please try again in a moment, or contact the school office.";

/**
 * The message for a database error. PostgREST hands back the raised text as
 * the error's message, which for these is the code and nothing else.
 */
export function bookingErrorMessage(raw: string | null | undefined): string {
  return (raw && MESSAGES[raw.trim()]) || FALLBACK;
}

/** A refusal the parent can act on, as opposed to something for the logs. */
export function isKnownBookingError(raw: string | null | undefined): boolean {
  return !!raw && raw.trim() in MESSAGES;
}
