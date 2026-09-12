import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { escapeHtml } from "@/lib/email/render";
import { paygateConfig } from "@/lib/payments/paygate";
import { processChecksum } from "@/lib/payments/paygate-wire";
import { paymentProviderName } from "@/lib/payments/provider";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireParentSession } from "@/lib/tokens/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The bridge to PayGate. PayWeb 3 wants the browser to POST the pay request
 * id and its checksum to process.trans, so this page renders that form and
 * submits it at once. Only the parent whose processing payment carries the
 * request id gets the form; anyone else is sent back to the payment page.
 */
export async function GET(request: Request): Promise<Response> {
  if (paymentProviderName() !== "paygate") redirect("/pay");
  // The one inline script this application writes by hand. It carries the
  // request's nonce or the browser refuses it — and the form below still has
  // its own button, so a parent gets to the gateway either way.
  const nonce = (await headers()).get("x-nonce") ?? "";
  const session = await requireParentSession();
  const ref = new URL(request.url).searchParams.get("ref") ?? "";
  const admin = createAdminClient();
  const { data: payment } = await admin
    .from("payments")
    .select("provider_ref, company_ref, status")
    .eq("application_id", session.applicationId)
    .eq("provider_ref", ref)
    .maybeSingle();
  if (!payment || payment.status !== "processing" || !payment.provider_ref) redirect("/pay");

  const { paygateId, key, apiUrl } = paygateConfig();
  const checksum = processChecksum(paygateId, payment.provider_ref, payment.company_ref, key);
  const action = `${apiUrl}process.trans`;
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
