"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { clearPromotion, recordPromotion } from "@/lib/promotions/load";
import { drainSoon, guarded, loadApplicationForStaff } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import { onOutcomeSent } from "@/lib/workflow/decision-actions";
import { onOfferApproved, onOfferDrafted, onOfferWithdrawn } from "@/lib/workflow/offer-actions";

/**
 * The human step before anything reaches a parent after a decision. Every
 * action here is the click the design deferred to a person in Phase 2.
 */

function done(applicationId: string) {
  revalidatePath("/staff/offers");
  revalidatePath(`/staff/applications/${applicationId}`);
  revalidatePath("/staff/tasks");
  revalidatePath("/staff");
}

export async function generateOffer(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("offers.approve");
    const p = z.object({ applicationId: z.uuid(), conditions: z.string().trim().max(1000).optional() }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, p.applicationId);
    const result = await onOfferDrafted(admin, app, ctx.actor, { conditions: p.conditions || null });
    if (result.blocked) throw new Error("No active fee schedule covers this campus, grade and year. Configure fees, then generate again.");
    drainSoon();
    done(app.id);
  });
}

export async function approveOffer(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("offers.approve");
    const p = z.object({ applicationId: z.uuid(), offerId: z.uuid() }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, p.applicationId);
    const { data: offer } = await admin.from("offers").select("*").eq("id", p.offerId).eq("application_id", app.id).single();
    if (!offer) throw new Error("Offer not found.");
    await onOfferApproved(admin, app, offer, ctx.actor);
    drainSoon();
    done(app.id);
  });
}

export async function withdrawOffer(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("offers.approve");
    const p = z.object({ applicationId: z.uuid(), offerId: z.uuid(), reason: z.string().trim().min(3).max(300) }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, p.applicationId);
    const { data: offer } = await admin.from("offers").select("*").eq("id", p.offerId).eq("application_id", app.id).single();
    if (!offer) throw new Error("Offer not found.");
    await onOfferWithdrawn(admin, app, offer, p.reason, ctx.actor);
    done(app.id);
  });
}

export async function sendOutcome(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("offers.approve");
    const p = z.object({ applicationId: z.uuid() }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, p.applicationId);
    await onOutcomeSent(admin, app, ctx.actor);
    drainSoon();
    done(app.id);
  });
}

/**
 * Staff put a deal on an application by hand (a parent who forgot the code,
 * a sibling arrangement agreed with the head) and the offer is re-drafted
 * with it. The who and why are kept on the application; the letter waits
 * for approval as before.
 */
export async function applyPromotionToOffer(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("offers.approve");
    const p = z
      .object({ applicationId: z.uuid(), promotionId: z.uuid({ error: "Choose a promotion" }), reason: z.string().trim().min(3, "Give a reason").max(300) })
      .parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, p.applicationId);
    if (app.status !== "offer_pending_approval" && app.status !== "offer_draft" && app.status !== "approved") {
      throw new Error("A promotion can only be applied before the offer is sent.");
    }
    const { data: promo } = await ctx.supabase.from("promotions").select("id, name, is_active").eq("id", p.promotionId).maybeSingle();
    if (!promo) throw new Error("Promotion not found.");
    if (!promo.is_active) throw new Error("That promotion is switched off.");
    await recordPromotion(admin, app.id, promo.id, "staff", { staffId: ctx.userId, reason: p.reason });
    await admin.from("audit_log").insert({
      actor_type: "staff", actor_id: ctx.userId, actor_label: ctx.actor.label ?? null, action: "promotion.applied", entity_type: "application", entity_id: app.id, application_id: app.id,
      after: { promotion_id: promo.id, promotion_name: promo.name, reason: p.reason },
    });
    await onOfferDrafted(admin, app, ctx.actor);
    drainSoon();
    done(app.id);
  });
}

export async function removePromotionFromOffer(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("offers.approve");
    const p = z.object({ applicationId: z.uuid(), reason: z.string().trim().min(3, "Give a reason").max(300) }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, p.applicationId);
    if (app.status !== "offer_pending_approval" && app.status !== "offer_draft" && app.status !== "approved") {
      throw new Error("A promotion can only be removed before the offer is sent.");
    }
    await clearPromotion(admin, app.id);
    // The parent's code stays on the record for reporting, but is no longer
    // re-applied: clearing it is what "remove" means.
    await admin.from("applications").update({ promo_code: null }).eq("id", app.id);
    await admin.from("audit_log").insert({
      actor_type: "staff", actor_id: ctx.userId, actor_label: ctx.actor.label ?? null, action: "promotion.removed", entity_type: "application", entity_id: app.id, application_id: app.id,
      after: { reason: p.reason },
    });
    await onOfferDrafted(admin, app, ctx.actor);
    drainSoon();
    done(app.id);
  });
}
