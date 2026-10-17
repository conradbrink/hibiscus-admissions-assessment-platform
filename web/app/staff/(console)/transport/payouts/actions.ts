"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { StaffActionState } from "@/components/staff/action-form";
import { can } from "@/lib/permissions";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import { parsePayoutForm } from "@/lib/transport/payout";
import { staffTransportError } from "@/lib/transport/staff-errors";

/**
 * Record a payment already made to the transport provider. The money moves
 * at the bank; this writes down which children it paid for and which credits
 * it took, through `transport_record_payout()`, which prices every charge
 * from the child's own line and keeps each child to one charge and one
 * credit. A recorded payout is never edited.
 */
export async function recordTransportPayout(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  let id: string | null = null;
  const state = await guarded(async () => {
    const ctx = await requireStaffAction("transport.finance");
    if (!can(ctx.permissions, "finance.write")) throw new Error("Recording a payout needs permission to record payments.");
    const p = parsePayoutForm(formData.entries());
    const { data, error } = await ctx.supabase.rpc("transport_record_payout", {
      p_provider_id: p.providerId,
      p_paid_on: p.paidOn,
      p_bank_reference: p.bankReference,
      p_note: p.note,
      p_charge_rider_ids: p.chargeRiderIds,
      p_credits: p.credits,
    });
    if (error) throw new Error(staffTransportError(error.message));
    id = data;
    revalidatePath("/staff/transport/payouts");
    revalidatePath("/staff/transport/earnings");
  });
  // Outside `guarded`: a redirect is thrown, and must not be read as a failure.
  if (id) redirect(`/staff/transport/payouts/${id}`);
  return state;
}
