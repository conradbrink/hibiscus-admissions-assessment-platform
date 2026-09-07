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
  if (!checksumValid(fields, key)) return new Response("bad checksum", { status: 401 });
  const m = fieldMap(fields);
  const admin = createAdminClient();
  const { data: payment } = await admin.from("payments").select("*").eq("provider_ref", m.PAY_REQUEST_ID ?? "").maybeSingle();
  if (payment && payment.status === "processing") {
    try {
      await reconcilePayment(admin, payment);
    } catch (e) {
      console.warn("[paygate] notify reconcile failed", payment.id, (e as Error).message);
    }
  }
  return new Response("OK", { headers: { "content-type": "text/plain" } });
}
