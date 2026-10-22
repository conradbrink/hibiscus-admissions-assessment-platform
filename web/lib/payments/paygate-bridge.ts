import "server-only";
import { escapeHtml } from "@/lib/email/render";
import { paygateConfig } from "@/lib/payments/paygate";
import { processChecksum } from "@/lib/payments/paygate-wire";

/**
 * The page that hands a payer to PayGate. PayWeb 3 wants the browser to POST
 * the pay request id and its checksum to process.trans, so this renders that
 * form and submits it at once.
 *
 * One function for every bridge (the applicant's at `/pay/gateway`, a
 * family's under `/family/extras/pay/<child>`), so the form PayGate receives
 * cannot differ between them. Each route decides first whose processing
 * payment the reference is; this only draws the form.
 */

/** Pure: the page itself. */
export function bridgePageHtml(opts: { action: string; payRequestId: string; checksum: string; nonce: string }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Going to the payment page</title>
<style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;color:#1f2937;background:#f8fafc}main{text-align:center;padding:24px}button{margin-top:16px;padding:10px 18px;font-size:16px;border-radius:8px;border:1px solid #cbd5e1;background:#fff}</style></head>
<body><main><p>Taking you to the secure payment page…</p>
<form method="post" action="${escapeHtml(opts.action)}" id="f">
<input type="hidden" name="PAY_REQUEST_ID" value="${escapeHtml(opts.payRequestId)}">
<input type="hidden" name="CHECKSUM" value="${escapeHtml(opts.checksum)}">
<button type="submit">Continue to payment</button>
</form>
<script${opts.nonce ? ` nonce="${escapeHtml(opts.nonce)}"` : ""}>document.getElementById("f").submit();</script></main></body></html>`;
}

/**
 * The response for one processing PayGate payment. The inline script carries
 * the request's nonce or the browser refuses it, and the form keeps its own
 * button, so the payer reaches the gateway either way.
 */
export function paygateBridgeResponse(payment: { provider_ref: string; company_ref: string }, nonce: string): Response {
  const { paygateId, key, apiUrl } = paygateConfig();
  const html = bridgePageHtml({
    action: `${apiUrl}process.trans`,
    payRequestId: payment.provider_ref,
    checksum: processChecksum(paygateId, payment.provider_ref, payment.company_ref, key),
    nonce,
  });
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" } });
}
