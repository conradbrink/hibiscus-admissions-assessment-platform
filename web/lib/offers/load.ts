import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { feeSnapshotFrom, type FeeSnapshot } from "@/lib/offers/snapshot";
import type { OfferRow } from "@/lib/supabase/types";

/**
 * The offer a parent may see for their application: sent, viewed or
 * expired. A draft or a withdrawn offer is not shown, whatever link they
 * arrived by.
 */
export async function loadVisibleOffer(admin: AdminClient, applicationId: string): Promise<(OfferRow & { feeSnapshot: FeeSnapshot | null }) | null> {
  const { data, error } = await admin
    .from("offers")
    .select("*")
    .eq("application_id", applicationId)
    .in("status", ["sent", "viewed", "expired", "accepted"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { ...data, feeSnapshot: feeSnapshotFrom(data.fees) };
}
