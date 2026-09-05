import { redirect } from "next/navigation";
import { drainSoon } from "@/lib/parent/actions";
import { reconcilePayment } from "@/lib/payments/reconcile";
import { createAdminClient } from "@/lib/supabase/admin";
import { readParentSession } from "@/lib/tokens/server";
import { PARENT_ACTOR } from "@/lib/workflow/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where the gateway sends the parent back. Nothing in the query string is
 * trusted: the gateway's transaction token is used only to pick which of
 * the application's processing payments to verify first, and must equal the
 * reference we stored. The verdict comes from asking the gateway.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await readParentSession();
  if (!session) redirect("/link?reason=payment_pending");
  const admin = createAdminClient();
  const hint = new URL(request.url).searchParams.get("TransactionToken");
  const { data: processing } = await admin
    .from("payments")
    .select("*")
    .eq("application_id", session.applicationId)
    .eq("status", "processing")
    .order("created_at", { ascending: false });
  const ordered = [...(processing ?? [])].sort((a, b) => (a.provider_ref === hint ? -1 : b.provider_ref === hint ? 1 : 0));
  for (const payment of ordered) {
    try {
      const outcome = await reconcilePayment(admin, payment, PARENT_ACTOR);
      if (outcome === "paid") break;
    } catch (e) {
      console.warn("[pay] return verify failed", payment.id, (e as Error).message);
    }
  }
  drainSoon();
  redirect("/pay");
}
