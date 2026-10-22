import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { processingAttemptForStudent } from "@/lib/family/extras";
import { familyClient } from "@/lib/family/scope";
import { paygateBridgeResponse } from "@/lib/payments/paygate-bridge";
import { paymentProviderName } from "@/lib/payments/provider";
import { readFamilySession } from "@/lib/tokens/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The PayGate bridge for a family paying for one child's extras.
 *
 * The applicant's bridge at `/pay/gateway` never receives the family's
 * cookie, which is scoped to `/family`, so a family sent there was told
 * their link had expired. This one sits under the child's own pay page,
 * finds the processing attempt through the family loaders (the child must be
 * theirs, the reference must be that child's), and draws the same form.
 */
export async function GET(request: Request, ctx: { params: Promise<{ studentId: string }> }): Promise<Response> {
  const { studentId } = await ctx.params;
  const back = `/family/extras/pay/${studentId}`;
  if (paymentProviderName() !== "paygate") redirect(back);
  const session = await readFamilySession();
  if (!session) redirect("/link?expired=1");

  const ref = new URL(request.url).searchParams.get("ref") ?? "";
  let attempt;
  try {
    attempt = await processingAttemptForStudent(familyClient(), session, studentId, ref);
  } catch {
    redirect("/family/extras");
  }
  if (!attempt?.provider_ref) redirect(back);
  const nonce = (await headers()).get("x-nonce") ?? "";
  return paygateBridgeResponse({ provider_ref: attempt.provider_ref, company_ref: attempt.company_ref }, nonce);
}
