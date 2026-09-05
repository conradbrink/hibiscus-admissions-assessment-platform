"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { loadApplicationGraph } from "@/lib/applications";
import { loadVisibleOffer } from "@/lib/offers/load";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request";
import { drainSoon } from "@/lib/parent/actions";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireParentSession } from "@/lib/tokens/server";
import { PARENT_ACTOR, WorkflowError } from "@/lib/workflow/engine";
import { onOfferAccepted, onOfferDeclined } from "@/lib/workflow/offer-actions";

/**
 * The parent's answer to the offer. The session names the application; the
 * offer is the one visible for it; nothing from the form chooses either.
 */

export type OfferDecisionState = { error?: string; fields?: Record<string, string> };

async function offerForSession() {
  const session = await requireParentSession();
  const admin = createAdminClient();
  const graph = await loadApplicationGraph(admin, session.applicationId);
  if (!graph) redirect("/link?reason=unknown");
  const offer = await loadVisibleOffer(admin, graph.application.id);
  return { admin, graph, offer };
}

export async function acceptOffer(_prev: OfferDecisionState, formData: FormData): Promise<OfferDecisionState> {
  const parsed = z.object({ terms: z.literal("1", { error: "Please tick the box to confirm you accept the terms." }) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fields: { terms: "Please tick the box to confirm you accept the terms." } };
  const { admin, graph, offer } = await offerForSession();
  if (!offer) return { error: "We could not find an offer to accept. Please use the link in your email." };
  const ctx = await requestContext();
  const verdict = await enforceRateLimit(admin, LIMITS.offerDecision, graph.application.id);
  if (!verdict.ok) return { error: "Please wait a moment and try again." };
  try {
    await onOfferAccepted(admin, graph.application, offer, { termsAccepted: true, ipHash: ctx.ipHash, userAgent: ctx.userAgent }, PARENT_ACTOR);
  } catch (e) {
    if (e instanceof WorkflowError) return { error: e.message };
    console.error("[offer] accept failed", e);
    return { error: "Something went wrong. Please try again, or contact admissions." };
  }
  drainSoon();
  redirect("/pay");
}

export async function declineOffer(_prev: OfferDecisionState, formData: FormData): Promise<OfferDecisionState> {
  const parsed = z.object({ reason: z.string().trim().max(500).optional() }).safeParse(Object.fromEntries(formData));
  const reason = parsed.success && parsed.data.reason ? parsed.data.reason : null;
  const { admin, graph, offer } = await offerForSession();
  if (!offer) return { error: "We could not find an offer to decline. Please use the link in your email." };
  const ctx = await requestContext();
  const verdict = await enforceRateLimit(admin, LIMITS.offerDecision, graph.application.id);
  if (!verdict.ok) return { error: "Please wait a moment and try again." };
  try {
    await onOfferDeclined(admin, graph.application, offer, { reason, ipHash: ctx.ipHash, userAgent: ctx.userAgent }, PARENT_ACTOR);
  } catch (e) {
    if (e instanceof WorkflowError) return { error: e.message };
    console.error("[offer] decline failed", e);
    return { error: "Something went wrong. Please try again, or contact admissions." };
  }
  drainSoon();
  redirect("/offer");
}
