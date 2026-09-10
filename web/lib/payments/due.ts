import type { FeeSnapshot } from "@/lib/offers/snapshot";
import { fullyWaived } from "@/lib/promotions/apply";

/**
 * What a parent owes at the moment they accept, and why.
 *
 * There are three honest answers and one error, and the product used to
 * collapse the middle two into the error. Bana Tlokweng charges nothing to
 * secure a place — their fee sheet says so, and every one of their schedules
 * is built that way — so the whole campus met a thrown
 * "finance must set a fee schedule before it can be accepted", raised *after*
 * the acceptance row and the offer's accepted status were already written.
 * The parent saw a failure, the application was left in a state no screen
 * could move on from, and retrying hit the unique index and said the offer
 * had already been answered.
 *
 * A deal that waives everything was already handled, because someone hit it
 * first. This is the same situation arrived at from the other direction:
 * nothing is due because nothing was ever charged.
 *
 * The error is now only the case that really is one — an offer carrying no
 * fee snapshot at all, which since the empty-schedule guard in
 * `onOfferDrafted` should not reach acceptance in the first place.
 */
export type AcceptanceCharge =
  | { kind: "payable"; amountMinor: number }
  | { kind: "waived"; reason: string }
  | { kind: "none"; reason: string }
  | { kind: "unpriced" };

export function chargeAtAcceptance(snapshot: FeeSnapshot | null): AcceptanceCharge {
  if (!snapshot) return { kind: "unpriced" };
  if (snapshot.payable_at_acceptance_minor > 0) {
    return { kind: "payable", amountMinor: snapshot.payable_at_acceptance_minor };
  }
  if (fullyWaived(snapshot)) {
    const promotion = (snapshot as { promotion?: { name?: string } | null }).promotion?.name ?? "a promotion";
    return { kind: "waived", reason: promotion };
  }
  return { kind: "none", reason: "Nothing is payable to secure a place at this campus" };
}

/** True when the place is secured without the parent paying anything. */
export const securedWithoutPaying = (c: AcceptanceCharge) => c.kind === "waived" || c.kind === "none";
