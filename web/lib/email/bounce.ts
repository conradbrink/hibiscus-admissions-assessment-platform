import type { DeliveryEvent } from "@/lib/email/provider";

/**
 * Turning a provider's bounce payload into one line a person can act on.
 *
 * Pure, and separate from `lib/email/resend.ts` because that file is
 * `server-only` and cannot be collected by a test. The shape it parses comes
 * off the wire from a third party, so the branches here are the ones worth
 * pinning: every field is optional, and a webhook that carries no detail at
 * all must still leave the message readable rather than say "undefined".
 */

/** Long provider prose truncated; the actionable part is always the front. */
const LIMIT = 500;

export type BouncePayload = {
  /** Resend: "Permanent" | "Transient" | "Undetermined". */
  type?: string;
  /** Resend: "General", "NoEmail", "MailboxFull", "Suppressed", … */
  subType?: string;
  /** The receiving server's own words, where the provider passes them on. */
  message?: string;
};

/**
 * Why this message did not arrive, or null when the event is not a failure
 * or the provider said nothing useful.
 *
 * Null rather than a placeholder: an empty reason column reads honestly as
 * "we were not told", whereas "Unknown bounce" reads like a finding and sends
 * somebody looking for a cause that was never reported.
 *
 * The classification is kept alongside the prose because it is the half that
 * decides what to do. `Permanent/NoEmail` means the address is wrong and the
 * family must be telephoned; `Transient/MailboxFull` means the address is
 * fine and the letter should go again. Both render as "bounced" on the screen
 * without it.
 */
export function bounceReason(
  kind: DeliveryEvent["kind"],
  bounce?: BouncePayload | null
): string | null {
  if (kind === "complained") {
    // No bounce object on a complaint: the recipient pressed "spam", and that
    // is the whole of what happened. Worth recording in the same field
    // because the consequence matches — this address is now unusable.
    return "Marked as spam by the recipient";
  }
  if (kind !== "bounced") return null;

  const classification = [bounce?.type, bounce?.subType].filter(Boolean).join("/");
  const prose = bounce?.message?.trim();
  const line = prose && classification ? `${classification}: ${prose}` : prose || classification;
  if (!line) return null;
  return line.length > LIMIT ? `${line.slice(0, LIMIT - 1)}…` : line;
}
