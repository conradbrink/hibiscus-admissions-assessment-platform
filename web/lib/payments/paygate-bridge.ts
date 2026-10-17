import "server-only";
import { escapeHtml } from "@/lib/email/render";
import { paygateConfig } from "@/lib/payments/paygate";
import { processChecksum } from "@/lib/payments/paygate-wire";

/**
 * The page that posts a parent on to PayGate. PayWeb 3 wants the browser to
 * POST the pay request id and its checksum to process.trans, so this renders
 * that form and submits it at once.
 *
 * Shared by every bridge route (`/pay/gateway`, `/family/pay/gateway`). Each
 * route finds the payment under its own session first; this only draws the
 * form for a payment that has already been checked.
 */
export function paygateBridgeResponse(payment: { provider_ref: string; company_ref: string }, nonce: string): Response {
  const { paygateId, key, apiUrl } = paygateConfig();
  const checksum = processChecksum(paygateId, payment.provider_ref, payment.company_ref, key);
  const action = `${apiUrl}process.trans`;
  // The one inline script this application writes by hand. It carries the
  // request's nonce or the browser refuses it — and the form below still has
  // its own button, so a parent gets to the gateway either way.
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Going to the payment page</title>
<style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;color:#1f2937;background:#f8fafc}main{text-align:center;padding:24px}button{margin-top:16px;padding:10px 18px;font-size:16px;border-radius:8px;border:1px solid #cbd5e1;background:#fff}</style></head>
<body><main><p>Taking you to the secure payment page…</p>
<form method="post" action="${escapeHtml(action)}" id="f">
<input type="hidden" name="PAY_REQUEST_ID" value="${escapeHtml(payment.provider_ref)}">
<input type="hidden" name="CHECKSUM" value="${escapeHtml(checksum)}">
<button type="submit">Continue to payment</button>
</form>
<script${nonce ? ` nonce="${escapeHtml(nonce)}"` : ""}>document.getElementById("f").submit();</script></main></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" } });
}
