/**
 * Where a gateway that needs a page of ours sends the payer before its own.
 *
 * PayGate wants the browser to POST to it, so its checkout goes through a
 * bridge page that renders that form; the dev gateway is a page of ours too.
 * Both must recognise the browser, and what a browser carries depends on who
 * is paying: an applicant's cookie is sent everywhere, but a family's is
 * scoped to `/family` and never reaches `/pay`. So the caller says where its
 * payer can be recognised (`bridgeBase`), and the provider builds its page's
 * address under it. Before this existed every bridge was under `/pay`, and a
 * family paying for extras through PayGate was sent to "your link has
 * expired".
 *
 * Pure, so a test pins the addresses.
 */

export const DEFAULT_BRIDGE_BASE = "/pay";

export type BridgePage = "gateway" | "dev";

/** A path on this site: no scheme, no host, no query, no trailing slash. */
function isSitePath(base: string): boolean {
  return /^(\/[A-Za-z0-9_-]+)+$/.test(base);
}

export function bridgeUrl(base: string | undefined, page: BridgePage, ref: string): string {
  const root = base ?? DEFAULT_BRIDGE_BASE;
  if (!isSitePath(root)) throw new Error(`Not a bridge path on this site: ${root}`);
  return `${root}/${page}?ref=${encodeURIComponent(ref)}`;
}
