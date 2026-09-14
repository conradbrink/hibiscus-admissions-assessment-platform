import { paygateConfig } from "@/lib/payments/paygate";
import { checksumValid, fieldMap, parseWire } from "@/lib/payments/paygate-wire";
import { paymentProviderName } from "@/lib/payments/provider";
import { reconcilePayment } from "@/lib/payments/reconcile";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PayGate's notify post: the outcome of a payment request, sealed with the
 * merchant key. It is treated as a prompt to verify, never as the verdict:
 * the payment is reconciled by asking PayGate's query.trans, exactly as the
 * return page and the reconciler do. PayGate expects the body "OK".
 */
export async function POST(request: Request): Promise<Response> {
  if (paymentProviderName() !== "paygate") return new Response("not configured", { status: 404 });
  const fields = parseWire(await request.text());
  const { key } = paygateConfig();
  // Logged, because this is how a rotated merchant key looks from here: every
  // notification silently 401s and payments simply stop confirming.
  if (!checksumValid(fields, key)) {
    console.warn("[paygate] notify failed its checksum — is PAYGATE_ENCRYPTION_KEY current?");
    return new Response("bad checksum", { status: 401 });
  }
  const m = fieldMap(fields);
  const admin = createAdminClient();
  if (!m.PAY_REQUEST_ID) {
    console.warn("[paygate] notify carried no PAY_REQUEST_ID");
    return new Response("OK", { headers: { "content-type": "text/plain" } });
  }
  const { data: payment } = await admin.from("payments").select("*").eq("provider_ref", m.PAY_REQUEST_ID).maybeSingle();
  if (!payment) {
    console.warn("[paygate] notify for an unknown request id", m.PAY_REQUEST_ID);
    return new Response("OK", { headers: { "content-type": "text/plain" } });
  }
  // `revive`, because we give up on a checkout after a few minutes and a
  // parent can still be on their bank's one-time-password screen when that
  // timer fires. A notify arriving after we stopped waiting is exactly the
  // case this exists for: money that landed late must still settle.
  if (["processing", "failed", "expired"].includes(payment.status)) {
    try {
      await reconcilePayment(admin, payment, undefined, { revive: true });
    } catch (e) {
      console.warn("[paygate] notify reconcile failed", payment.id, (e as Error).message);
    }
  }
  return new Response("OK", { headers: { "content-type": "text/plain" } });
}
