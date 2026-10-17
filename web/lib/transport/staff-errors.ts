/**
 * What a member of staff is told when the database refuses a transport
 * action: cancelling, refunding, paying the provider, or setting up a term.
 *
 * The functions raise short codes (the CRM convention), and `guarded` shows
 * any thrown message as written, so without this a person at the screen
 * would read `transport_payout_credit_not_due`. `staff-errors.test.ts` reads
 * the migrations and fails if a code they raise has a sentence neither here
 * nor in the parent's list (`errors.ts`).
 *
 * Several of these mean the screen was out of date: somebody else cancelled
 * the child or paid the line a moment earlier. Those say to reload.
 */

const RELOAD = "Reload the page and try again.";

export const STAFF_REFUSALS: Record<string, string> = {
  permission_denied: "You do not have permission to do that.",

  // Cancelling.
  transport_reason_required: "Say why, in a few words.",
  transport_booking_not_found: "That booking could not be found.",
  transport_booking_not_allowed: "A child on this booking goes to a school you cannot see. Ask a colleague who covers every school on it.",
  transport_payment_in_progress: "A payment on this booking is still being confirmed. Wait until it is paid or has failed, then try again.",
  transport_rider_not_on_booking: `One of those children is already cancelled or is not on this booking. ${RELOAD}`,
  transport_nothing_to_cancel: `Nothing is left to cancel on this booking. ${RELOAD}`,
  transport_unpaid_cancel_whole: "This booking is not paid yet, so it is cancelled whole, not child by child.",
  transport_booking_not_cancellable: "This booking has expired or was abandoned. There is nothing to cancel.",

  // Refunds.
  transport_refund_amount: "Enter the amount that was refunded.",
  transport_rider_not_found: `That child could not be found on the booking. ${RELOAD}`,
  transport_refund_needs_cancel: "Cancel the child's transport before recording a refund for it.",
  transport_refund_nothing_paid: "Nothing was paid on this booking, so there is nothing to refund.",
  transport_refund_too_much: "That is more than is left to refund on this child's line.",

  // Paying the provider.
  transport_payout_reference_required: "Enter the bank reference of the payment.",
  transport_payout_date: "The payment date cannot be in the future.",
  transport_payout_credits_invalid: `The credits could not be read. ${RELOAD}`,
  transport_payout_duplicate_line: `A child appears twice in this payment. ${RELOAD}`,
  transport_payout_wrong_provider: `One of these children is with a different provider. ${RELOAD}`,
  transport_payout_line_not_payable: `One of these children is no longer booked on a paid booking. ${RELOAD}`,
  transport_payout_already_paid: `One of these children was already paid for in another payment. ${RELOAD}`,
  transport_payout_credit_not_due: `A credit is only for a child who was cancelled after the provider was paid for them. ${RELOAD}`,
  transport_payout_already_credited: `One of these children was already credited. ${RELOAD}`,
  transport_payout_credit_amount: "A credit must be more than nothing and no more than the provider was paid for that child.",
  transport_payout_nothing_owed: "The credits are as large as the charges, so nothing is owed. Add more children, or lower a credit.",
  transport_payout_immutable: "A recorded payment cannot be changed. Record a new one to correct it.",

  // Setting up terms, months and the terms wording.
  transport_month_needs_a_term: "A month must belong to a term.",
  transport_month_index_out_of_range: "A term has only so many months. Check the month number.",
  transport_month_outside_term: "A month's dates must fall inside its term's dates.",
  transport_terms_published: "Published terms cannot be changed. Publish a new version instead.",
  transport_periods_check: "Check the dates: the end comes after the start, and booking closes after it opens and before the period ends.",
  transport_nett_exceeds_price: "The provider's price would be more than the parent pays. Check the prices.",

  // Rules the screens should never reach, worded in case one does.
  transport_booking_frozen: "A booking's period, area and terms cannot be changed after it is made.",
  transport_rider_frozen: "A child's priced line cannot be changed after the booking is made.",
  transport_booking_status_illegal: `That change of status is not allowed. ${RELOAD}`,
  transport_booking_not_paid: "The booking can be marked paid only once its payment is confirmed.",
  transport_booking_has_riders: "A booking is cancelled only once every child on it is cancelled.",
  transport_booking_born_paid: "A booking starts unpaid.",
  transport_booking_active: "This booking's period has not ended, so its details are kept.",
};

/** The sentence for a refusal, or the message as it came if it is not one of ours. */
export function staffTransportError(message: string): string {
  // The longest code the message contains, so one code that happens to be
  // the start of another can never answer for it.
  const code = Object.keys(STAFF_REFUSALS)
    .filter((c) => message.includes(c))
    .sort((a, b) => b.length - a.length)[0];
  return code ? STAFF_REFUSALS[code] : message;
}
