import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { ApplicationRow, Json, OfferRow } from "@/lib/supabase/types";
import { loadApplicationGraph } from "@/lib/applications";
import { buildOfferVariables, feeSnapshotFrom, loadActiveOfferTemplate, renderOffer, resolveFeeSchedule, snapshotFees, type FeeSnapshot } from "@/lib/offers/render";
import { getSettings } from "@/lib/settings";
import { commit, WorkflowError, type Actor, type JobSpec } from "@/lib/workflow/engine";

/**
 * From approved to a sent offer, and what can happen to an offer after
 * that. Every move goes through the engine so the application's status,
 * the timeline and the audit trail follow the offer.
 *
 * Every email and job here carries the offer id in its idempotency key: an
 * offer withdrawn and re-issued is a new offer with its own reminders, and
 * the old ones skip themselves on their precondition.
 */

const DAY = 86_400_000;

async function liveOffer(admin: AdminClient, applicationId: string): Promise<OfferRow | null> {
  const { data, error } = await admin
    .from("offers")
    .select("*")
    .eq("application_id", applicationId)
    .in("status", ["draft", "pending_approval", "sent", "viewed"])
    .maybeSingle();
  if (error) throw new WorkflowError(error.message, "database");
  return data;
}

/**
 * Drafts (or re-drafts) the offer. If a fee schedule exists the offer goes
 * straight into the approval queue; if not it rests as a draft with a task
 * for finance, and Generate can be pressed again once fees are configured.
 */
export async function onOfferDrafted(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "status" | "child_first_name" | "requires_assessment">,
  actor: Actor,
  opts: { conditions?: string | null } = {}
): Promise<{ offerId: string; blocked: boolean }> {
  if (app.status !== "approved" && app.status !== "offer_draft") {
    throw new WorkflowError(`Application is ${app.status}; an offer can be drafted from approved or offer_draft`, "status_conflict");
  }
  const existing = await liveOffer(admin, app.id);
  if (existing && existing.status !== "draft") {
    throw new WorkflowError(`An offer is already ${existing.status}`, "status_conflict");
  }

  const [graph, template, settings] = await Promise.all([
    loadApplicationGraph(admin, app.id),
    loadActiveOfferTemplate(admin),
    getSettings(admin),
  ]);
  if (!graph) throw new WorkflowError("application missing", "database");
  if (!template) throw new WorkflowError("No active offer template. Publish one under Offer templates.", "database");

  const resolved = await resolveFeeSchedule(admin, {
    campusId: graph.application.campus_id,
    academicYearId: graph.intake.academic_year_id,
    gradeSort: graph.grade.sort_order,
  });
  const fees: FeeSnapshot | null = resolved ? snapshotFees(resolved.schedule, resolved.lines) : null;
  const conditions = opts.conditions ?? existing?.conditions ?? null;
  // Provisional expiry for the preview; the real one is stamped at approval.
  const provisionalExpiry = new Date(Date.now() + settings.offerExpiryDays * DAY);
  const vars = buildOfferVariables(graph, fees, { expiresAt: provisionalExpiry, conditions });
  const rendered = renderOffer(template, vars);

  const row = {
    application_id: app.id,
    template_id: template.id,
    template_version: template.version,
    fee_schedule_id: resolved?.schedule.id ?? null,
    currency: fees?.currency ?? graph.campus.currency,
    variables: vars as unknown as Json,
    rendered_html: rendered.html,
    terms_html: rendered.terms,
    fees: (fees ?? {}) as unknown as Json,
    start_date: graph.intake.starts_on,
    conditions,
    status: fees ? "pending_approval" : "draft",
  } as const;

  let offerId: string;
  if (existing) {
    const { error } = await admin.from("offers").update(row).eq("id", existing.id);
    if (error) throw new WorkflowError(error.message, "database");
    offerId = existing.id;
  } else {
    const { data, error } = await admin.from("offers").insert(row).select("id").single();
    if (error || !data) throw new WorkflowError(error?.message ?? "offer insert failed", "database");
    offerId = data.id;
  }

  if (app.status === "approved") {
    await commit(admin, {
      applicationId: app.id,
      expectedStatus: "approved",
      newStatus: "offer_draft",
      nextAction: "await_offer",
      event: { type: "offer.drafted", summary: "Offer drafted", payload: { offer_id: offerId, fees_found: !!fees } },
      audit: { action: "offer.drafted", entityType: "offer", entityId: offerId },
      actor,
    });
  }

  if (!fees) {
    await commit(admin, {
      applicationId: app.id,
      expectedStatus: "offer_draft",
      newStatus: "offer_draft",
      nextAction: "await_offer",
      event: {
        type: "offer.blocked",
        summary: `Offer cannot be sent: no active fee schedule for ${graph.campus.name}, ${graph.grade.name}, ${graph.intake.label}`,
        payload: { offer_id: offerId },
      },
      tasks: [
        {
          type: "configure_fees",
          title: `Configure fees for ${graph.campus.name} — ${graph.grade.name}`,
          details: `${app.child_first_name}'s offer is waiting on an active fee schedule for ${graph.intake.label}. Set it under Fees, then press Generate offer on the applicant.`,
          priority: "high",
        },
      ],
      actor,
    });
    return { offerId, blocked: true };
  }

  await commit(admin, {
    applicationId: app.id,
    expectedStatus: "offer_draft",
    newStatus: "offer_pending_approval",
    nextAction: "await_offer",
    event: { type: "offer.pending_approval", summary: "Offer ready for approval", payload: { offer_id: offerId } },
    resolveTaskTypes: ["configure_fees"],
    tasks: [
      {
        type: "approve_offer",
        title: `Approve and send ${app.child_first_name}'s offer`,
        details: "Check the learning profile and the offer together on the Offers & outcomes page, then Approve & send.",
        priority: "high",
      },
    ],
    actor,
  });

  if (settings.offerAutoApprove) {
    const { data: offer } = await admin.from("offers").select("*").eq("id", offerId).single();
    if (offer) await onOfferApproved(admin, { ...app, status: "offer_pending_approval" }, offer, actor);
  }
  return { offerId, blocked: false };
}

/**
 * Approve & send. Refused unless the learning profile exists (an assessed
 * applicant's results email links it), stamps the real expiry, re-renders
 * with it, and queues the email, the reminders and the expiry sweep.
 */
export async function onOfferApproved(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "status" | "child_first_name" | "requires_assessment">,
  offer: Pick<OfferRow, "id" | "status" | "template_id" | "conditions" | "fees">,
  actor: Actor
): Promise<void> {
  if (app.status !== "offer_pending_approval" || offer.status !== "pending_approval") {
    throw new WorkflowError("This offer is not waiting for approval", "status_conflict");
  }
  if (app.requires_assessment) {
    const { data: profile } = await admin
      .from("learning_profiles")
      .select("id")
      .eq("application_id", app.id)
      .not("published_at", "is", null)
      .limit(1);
    if (!profile?.length) {
      throw new WorkflowError("The learning profile has not been generated yet; the results email needs it. Try again in a minute.", "status_conflict");
    }
  }

  const [graph, settings] = await Promise.all([loadApplicationGraph(admin, app.id), getSettings(admin)]);
  if (!graph) throw new WorkflowError("application missing", "database");
  const { data: template } = await admin.from("offer_templates").select("*").eq("id", offer.template_id).single();
  if (!template) throw new WorkflowError("offer template missing", "database");

  const expiresAt = new Date(Date.now() + settings.offerExpiryDays * DAY);
  const fees = feeSnapshotFrom(offer.fees);
  const vars = buildOfferVariables(graph, fees, { expiresAt, conditions: offer.conditions });
  const rendered = renderOffer(template, vars);
  const now = new Date().toISOString();
  const { error } = await admin
    .from("offers")
    .update({
      status: "sent",
      variables: vars as unknown as Json,
      rendered_html: rendered.html,
      terms_html: rendered.terms,
      expires_at: expiresAt.toISOString(),
      approved_by: actor.type === "staff" ? (actor.id ?? null) : null,
      approved_at: now,
      sent_at: now,
    })
    .eq("id", offer.id)
    .eq("status", "pending_approval");
  if (error) throw new WorkflowError(error.message, "database");

  const live = { offer_id: offer.id, offer_status: ["sent", "viewed"] };
  const jobs: JobSpec[] = [
    {
      type: "send_email",
      payload: { template_key: "results_and_offer", links: app.requires_assessment ? ["results", "offer"] : ["offer"], offer_id: offer.id },
      idempotencyKey: `email:${app.id}:results_and_offer:${offer.id}`,
    },
    {
      type: "offer_expire",
      payload: { offer_id: offer.id },
      idempotencyKey: `offer_expire:${offer.id}`,
      runAfter: new Date(expiresAt.getTime() + 60_000),
      precondition: live,
    },
  ];
  for (const days of settings.offerReminderDaysBefore) {
    const at = new Date(expiresAt.getTime() - days * DAY);
    if (at.getTime() <= Date.now() + 15 * 60_000) continue;
    jobs.push({
      type: "send_email",
      payload: { template_key: "offer_reminder", links: ["offer"], offer_id: offer.id },
      idempotencyKey: `email:${app.id}:offer_reminder:${offer.id}:${days}d`,
      runAfter: at,
      precondition: live,
    });
  }

  await commit(admin, {
    applicationId: app.id,
    expectedStatus: "offer_pending_approval",
    newStatus: "offer_sent",
    nextAction: "review_offer",
    nextActionDueAt: expiresAt,
    event: { type: "offer.sent", summary: `Offer approved and sent; open until ${expiresAt.toDateString()}`, payload: { offer_id: offer.id, expires_at: expiresAt.toISOString() } },
    resolveTaskTypes: ["approve_offer"],
    jobs,
    audit: { action: "offer.approved", entityType: "offer", entityId: offer.id, after: { expires_at: expiresAt.toISOString() } },
    actor,
  });
}

/** The parent opened the offer. A pure event; the offer row records the first view. */
export async function onOfferViewed(admin: AdminClient, app: Pick<ApplicationRow, "id">, offer: Pick<OfferRow, "id" | "status">): Promise<void> {
  if (offer.status !== "sent") return;
  const { data } = await admin
    .from("offers")
    .update({ status: "viewed", first_viewed_at: new Date().toISOString() })
    .eq("id", offer.id)
    .eq("status", "sent")
    .select("id");
  if (!data?.length) return;
  await commit(admin, {
    applicationId: app.id,
    expectedStatus: null,
    newStatus: null,
    nextAction: null,
    event: { type: "offer.viewed", summary: "Parent opened the offer", payload: { offer_id: offer.id } },
    actor: { type: "parent", label: "Parent (via link)" },
  });
}

export async function onOfferExpired(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "status" | "child_first_name">,
  offer: Pick<OfferRow, "id" | "status">,
  actor: Actor
): Promise<void> {
  if (app.status !== "offer_sent") throw new WorkflowError(`Application is ${app.status}`, "status_conflict");
  const { error } = await admin.from("offers").update({ status: "expired" }).eq("id", offer.id).in("status", ["sent", "viewed"]);
  if (error) throw new WorkflowError(error.message, "database");
  await commit(admin, {
    applicationId: app.id,
    expectedStatus: "offer_sent",
    newStatus: "offer_expired",
    nextAction: "none",
    event: { type: "offer.expired", summary: "Offer expired without a response", payload: { offer_id: offer.id } },
    tasks: [
      {
        type: "follow_up_expired_offer",
        title: `Follow up ${app.child_first_name}'s expired offer`,
        details: "The parent did not respond before the expiry date. Call, then re-issue the offer from the applicant page if they still want the place.",
        priority: "normal",
      },
    ],
    jobs: [
      {
        type: "send_email",
        payload: { template_key: "offer_expired", offer_id: offer.id },
        idempotencyKey: `email:${app.id}:offer_expired:${offer.id}`,
      },
    ],
    audit: { action: "offer.expired", entityType: "offer", entityId: offer.id },
    actor,
  });
}

/** Staff take an offer back to correct and re-issue it. Its reminders skip themselves. */
export async function onOfferWithdrawn(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "status">,
  offer: Pick<OfferRow, "id" | "status">,
  reason: string,
  actor: Actor
): Promise<void> {
  const fromStatuses = ["offer_sent", "offer_pending_approval", "offer_draft", "offer_expired"];
  if (!fromStatuses.includes(app.status)) throw new WorkflowError(`Application is ${app.status}`, "status_conflict");
  const { error } = await admin
    .from("offers")
    .update({ status: "withdrawn", withdrawn_reason: reason })
    .eq("id", offer.id)
    .in("status", ["draft", "pending_approval", "sent", "viewed", "expired"]);
  if (error) throw new WorkflowError(error.message, "database");
  await commit(admin, {
    applicationId: app.id,
    expectedStatus: app.status,
    newStatus: "offer_draft",
    nextAction: "await_offer",
    event: { type: "offer.withdrawn", summary: `Offer withdrawn: ${reason}`, payload: { offer_id: offer.id, reason } },
    resolveTaskTypes: ["approve_offer", "follow_up_expired_offer"],
    audit: { action: "offer.withdrawn", entityType: "offer", entityId: offer.id, after: { reason } },
    actor,
  });
}
