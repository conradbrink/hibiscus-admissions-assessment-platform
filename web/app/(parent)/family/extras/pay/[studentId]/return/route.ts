import { redirect } from "next/navigation";
import { loadStudentPaymentAttempts, paymentAttemptForStudent } from "@/lib/family/extras";
import { familyClient } from "@/lib/family/scope";
import { hintFirst } from "@/lib/payments/attempts";
import { fieldMap, parseWire } from "@/lib/payments/paygate-wire";
import { paymentProviderName } from "@/lib/payments/provider";
import { reconcilePayment } from "@/lib/payments/reconcile";
import { readFamilySession } from "@/lib/tokens/server";
import { PARENT_ACTOR } from "@/lib/workflow/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where the gateway sends a parent back after paying for an order.
 *
 * Nothing in the query string is trusted. The gateway's token only decides
 * which of this child's processing payments to ask about first; the verdict
 * comes from asking the gateway, in `reconcilePayment`. The same shape as the
 * admissions return (`app/(parent)/pay/return/route.ts`), scoped to a child
 * through the family loaders rather than to an application.
 */
export async function GET(request: Request, ctx: { params: Promise<{ studentId: string }> }): Promise<Response> {
  const { studentId } = await ctx.params;
  const session = await readFamilySession();
  if (!session) redirect("/link?reason=payment_pending");
  const admin = familyClient();

  let attempts;
  try {
    attempts = await loadStudentPaymentAttempts(admin, session, studentId);
  } catch {
    redirect("/family/extras");
  }

  const hint = new URL(request.url).searchParams.get("TransactionToken");
  for (const payment of hintFirst(attempts, hint)) {
    try {
      const outcome = await reconcilePayment(admin, payment, PARENT_ACTOR, { revive: true });
      if (outcome === "paid") break;
    } catch (e) {
      console.warn("[extras pay] return verify failed", payment.id, (e as Error).message);
    }
  }
  redirect(`/family/extras/pay/${studentId}`);
}

/**
 * PayGate sends the parent back with a cross-site POST, which arrives without
 * the family cookie. So the payment is found by the request id PayGate posted —
 * not by anything about the family — verified, and the parent is then
 * redirected to a page where the cookie is present again.
 */
export async function POST(request: Request, ctx: { params: Promise<{ studentId: string }> }): Promise<Response> {
  const { studentId } = await ctx.params;
  if (paymentProviderName() === "paygate") {
    const m = fieldMap(parseWire(await request.text()));
    const admin = familyClient();
    // The posted reference has to name a payment for *this* child; one
    // belonging to another family matches nothing.
    const payment = await paymentAttemptForStudent(admin, studentId, m.PAY_REQUEST_ID ?? "");
    if (payment) {
      try {
        await reconcilePayment(admin, payment, PARENT_ACTOR, { revive: true });
      } catch (e) {
        console.warn("[extras pay] return verify failed", payment.id, (e as Error).message);
      }
    }
  }
  return Response.redirect(new URL(`/family/extras/pay/${studentId}`, request.url), 303);
}
