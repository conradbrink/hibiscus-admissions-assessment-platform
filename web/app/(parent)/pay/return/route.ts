import { redirect } from "next/navigation";
import { drainSoon } from "@/lib/parent/actions";
import { askable, ATTEMPT_STATUSES, hintFirst, recentAttemptsSince } from "@/lib/payments/attempts";
import { reconcilePayment } from "@/lib/payments/reconcile";
import { createAdminClient } from "@/lib/supabase/admin";
import { readParentSession } from "@/lib/tokens/server";
import { paymentProviderName } from "@/lib/payments/provider";
import { fieldMap, parseWire } from "@/lib/payments/paygate-wire";
import { PARENT_ACTOR } from "@/lib/workflow/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where the gateway sends the parent back. Nothing in the query string is
 * trusted: the gateway's transaction token is used only to pick which of
 * the application's recent attempts to verify first, and must equal the
 * reference we stored. The verdict comes from asking the gateway.
 *
 * Every recent attempt, not only the processing ones, and asked with
 * `revive`: a parent who took longer than our attempt window on their bank's
 * screen comes back to a row we have already marked expired, and the payment
 * they just made has to be found now, on this page, not by a sweep an hour
 * on — the alternative is a page telling them nothing was charged.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await readParentSession();
  if (!session) redirect("/link?reason=payment_pending");
  const admin = createAdminClient();
  const hint = new URL(request.url).searchParams.get("TransactionToken");
  const { data: attempts } = await admin
    .from("payments")
    .select("*")
    .eq("application_id", session.applicationId)
    .eq("method", "online")
    .in("status", [...ATTEMPT_STATUSES])
    .not("provider_ref", "is", null)
    .gte("created_at", recentAttemptsSince())
    .order("created_at", { ascending: false })
    .limit(5);
  for (const payment of hintFirst(attempts ?? [], hint)) {
    try {
      const outcome = await reconcilePayment(admin, payment, PARENT_ACTOR, { revive: true });
      if (outcome === "paid") break;
    } catch (e) {
      console.warn("[pay] return verify failed", payment.id, (e as Error).message);
    }
  }
  drainSoon();
  redirect("/pay");
}

/**
 * PayGate sends the parent back with a POST. A cross-site POST arrives
 * without the parent's session cookie, so the payment is found by the
 * request id PayGate posted, verified with PayGate, and the parent is then
 * redirected to the payment page, where the cookie is present again.
 */
export async function POST(request: Request): Promise<Response> {
  if (paymentProviderName() === "paygate") {
    const m = fieldMap(parseWire(await request.text()));
    const admin = createAdminClient();
    const { data: payment } = await admin.from("payments").select("*").eq("provider_ref", m.PAY_REQUEST_ID ?? "").maybeSingle();
    if (payment && askable(payment)) {
      try {
        await reconcilePayment(admin, payment, PARENT_ACTOR, { revive: true });
      } catch (e) {
        console.warn("[pay] return verify failed", payment.id, (e as Error).message);
      }
    }
    drainSoon();
  }
  return Response.redirect(new URL("/pay", request.url), 303);
}
