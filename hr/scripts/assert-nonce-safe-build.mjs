#!/usr/bin/env node
/**
 * Every page must be rendered per request, because every page carries a
 * Content-Security-Policy nonce.
 *
 * A prerendered page is built once, at deploy time, with whatever nonce the
 * build happened to see — or none at all. The header on each later response
 * names a fresh one. The browser compares the two, finds they disagree, and
 * refuses every script on the page. It fails silently from the server's point
 * of view: the HTML is 200, the page paints, and nothing works.
 *
 * That is exactly what the enquiry form and the sign-in page did the first
 * time the nonce was switched on, which is why this check exists rather than
 * a note in a comment. `export const dynamic = "force-dynamic"` in the root
 * layout is what keeps it true; this is what notices if that stops being so.
 *
 * Two kinds of route are allowed to stay static, and neither runs a script:
 *
 *   the icon routes          PNG bytes
 *   /_global-error           Next's own last-resort page, shown only when the
 *                            root layout itself threw. It is plain text with
 *                            no interactivity to lose.
 */
import { readFileSync } from "node:fs";

const ALLOWED = new Set(["/icon.png", "/apple-icon.png", "/_global-error"]);

let manifest;
try {
  manifest = JSON.parse(readFileSync(".next/prerender-manifest.json", "utf8"));
} catch {
  console.error("No .next/prerender-manifest.json — run this after `next build`.");
  process.exit(1);
}

const prerendered = Object.keys(manifest.routes ?? {});
const offenders = prerendered.filter((route) => !ALLOWED.has(route));

if (offenders.length) {
  console.error(
    [
      "These routes are prerendered, and every script on them will be refused by the",
      "Content-Security-Policy, because a page built once cannot carry a nonce minted",
      "per request:",
      "",
      ...offenders.map((r) => `  ${r}`),
      "",
      "The root layout sets `export const dynamic = \"force-dynamic\"`; something has",
      "opted back out of it. Either restore that, or — if the page genuinely runs no",
      "scripts — add it to ALLOWED in this file and say why.",
    ].join("\n")
  );
  process.exit(1);
}

console.log(`Nonce-safe: nothing prerendered but ${[...ALLOWED].join(", ")}.`);
