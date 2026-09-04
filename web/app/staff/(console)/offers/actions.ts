"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { drainSoon, guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";
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

async function loadApp(applicationId: string) {
  const admin = createAdminClient();
  const { data: app, error } = await admin.from("applications").select("*").eq("id", applicationId).single();
  if (error || !app) throw new Error("Application not found.");
  return { admin, app };
}

export async function generateOffer(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("offers.approve");
    const p = z.object({ applicationId: z.uuid(), conditions: z.string().trim().max(1000).optional() }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApp(p.applicationId);
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
    const { admin, app } = await loadApp(p.applicationId);
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
    const { admin, app } = await loadApp(p.applicationId);
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
    const { admin, app } = await loadApp(p.applicationId);
    await onOutcomeSent(admin, app, ctx.actor);
    drainSoon();
    done(app.id);
  });
}
