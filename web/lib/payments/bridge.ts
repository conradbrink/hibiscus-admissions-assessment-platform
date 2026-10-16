/**
 * Where a parent is sent between our pay button and the gateway.
 *
 * PayGate needs a page of ours that posts the parent on to its own, and the
 * development gateway is a page of ours outright. Both have to read the
 * parent's session to find their payment, so both must live under the path
 * that session's cookie is sent to.
 *
 * Both used to be fixed at `/pay/gateway` and `/pay/dev`, which only the
 * admissions cookie reaches (path `/`). The family cookie is scoped to
 * `/family`, so a family paying for extras was sent to a page their browser
 * sent no session to, and landed on "this link has expired" with the payment
 * left processing. The caller now says which bridge belongs to its payer.
 *
 * Pure, and deliberately not `server-only`, so the routes and the tests can
 * share it.
 */

export const BRIDGE_BASES = ["/pay", "/family/pay"] as const;
export type BridgeBase = (typeof BRIDGE_BASES)[number];

export function bridgeUrl(base: BridgeBase, page: "gateway" | "dev", ref: string): string {
  return `${base}/${page}?ref=${encodeURIComponent(ref)}`;
}
