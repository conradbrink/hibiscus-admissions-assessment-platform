import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { JobRow } from "@/lib/supabase/types";
import { SYSTEM_ACTOR, WorkflowError } from "@/lib/workflow/engine";
import type { HandlerResult } from "@/lib/workflow/handlers";
import { onOfferDrafted, onOfferExpired } from "@/lib/workflow/offer-actions";

export async function draftOfferHandler(admin: AdminClient, job: JobRow): Promise<HandlerResult> {
  if (!job.application_id) return { outcome: "failed", error: "draft_offer job missing application", retryable: false };
  const { data: app } = await admin.from("applications").select("id, status, child_first_name, requires_assessment").eq("id", job.application_id).single();
  if (!app) return { outcome: "skipped", reason: "application missing" };
  if (app.status !== "approved" && app.status !== "offer_draft") return { outcome: "skipped", reason: `application is ${app.status}` };
  try {
    // A blocked draft is still done: the configure_fees task carries it from here.
    await onOfferDrafted(admin, app, SYSTEM_ACTOR);
    return { outcome: "done" };
  } catch (e) {
    if (e instanceof WorkflowError && e.code === "status_conflict") return { outcome: "skipped", reason: e.message };
    throw e;
  }
}

/** The expiry sweep. Re-checks the offer itself: a re-issued offer has a new id and its own sweep. */
export async function offerExpireHandler(admin: AdminClient, job: JobRow): Promise<HandlerResult> {
  const p = job.payload as { offer_id?: string };
  if (!p.offer_id) return { outcome: "failed", error: "offer_expire job missing offer_id", retryable: false };
  const { data: offer } = await admin.from("offers").select("*").eq("id", p.offer_id).maybeSingle();
  if (!offer) return { outcome: "skipped", reason: "offer missing" };
  if (offer.status !== "sent" && offer.status !== "viewed") return { outcome: "skipped", reason: `offer is ${offer.status}` };
  if (!offer.expires_at || new Date(offer.expires_at).getTime() > Date.now()) {
    return { outcome: "failed", error: "offer not yet expired; retrying later", retryable: true };
  }
  const { data: app } = await admin.from("applications").select("id, status, child_first_name").eq("id", offer.application_id).single();
  if (!app) return { outcome: "skipped", reason: "application missing" };
  if (app.status !== "offer_sent") return { outcome: "skipped", reason: `application is ${app.status}` };
  await onOfferExpired(admin, app, offer, SYSTEM_ACTOR);
  return { outcome: "done" };
}
