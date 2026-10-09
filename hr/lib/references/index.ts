import "server-only";
import { z } from "zod";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";
import { audit, type Actor } from "@/lib/audit";
import { sendTemplate } from "@/lib/email/send";
import { HrError } from "@/lib/errors";
import { formatDate } from "@/lib/format-date";
import { enqueue } from "@/lib/jobs/queue";
import { fullName } from "@/lib/recruitment/bundle";
import { mintToken, revokeReferenceTokens, siteUrl } from "@/lib/tokens";

/**
 * References: the request email, the reminders, the expiry, and the
 * questionnaire a referee fills in.
 *
 * A referee is never a database principal. Their link names one reference
 * request; everything here is scoped by that id.
 */

export const RATING_KEYS = ["teaching", "classroom_management", "reliability", "teamwork", "parent_communication", "professionalism"] as const;

export const RATING_LABELS: Record<(typeof RATING_KEYS)[number], string> = {
  teaching: "Teaching ability",
  classroom_management: "Classroom management",
  reliability: "Reliability and punctuality",
  teamwork: "Working with colleagues",
  parent_communication: "Communication with parents",
  professionalism: "Professionalism",
};

const Rating = z.coerce.number().int().min(1).max(5);

export const ReferenceFormSchema = z
  .object({
    capacity: z.enum(["principal", "line_manager", "colleague", "other"]),
    known_from: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/).optional().or(z.literal("")),
    known_to: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/).optional().or(z.literal("")),
    role_and_dates_confirmed: z.enum(["yes", "no"]),
    role_and_dates_note: z.string().max(1000).optional(),
    ratings: z.object(Object.fromEntries(RATING_KEYS.map((k) => [k, Rating])) as Record<(typeof RATING_KEYS)[number], typeof Rating>),
    concern: z.enum(["yes", "no"]),
    concern_detail: z.string().max(3000).optional(),
    reason_for_leaving: z.string().max(1000).optional(),
    would_reemploy: z.enum(["yes", "no", "not_applicable"]),
    recommendation: z.enum(["yes", "with_reservations", "no"]),
    comments: z.string().max(3000).optional(),
    referee_name_confirmed: z.string().trim().min(2).max(200),
  })
  .refine((v) => v.concern === "no" || (v.concern_detail ?? "").trim().length > 0, {
    message: "Please tell us about the concern.",
    path: ["concern_detail"],
  });

export type ReferenceForm = z.infer<typeof ReferenceFormSchema>;

async function loadRequest(admin: AdminClient, requestId: string) {
  const { data: request, error } = await admin.from("hr_reference_requests").select("*").eq("id", requestId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!request) return null;
  const [{ data: referee }, { data: application }] = await Promise.all([
    admin.from("hr_referees").select("*").eq("id", request.referee_id).single(),
    admin.from("hr_applications").select("*").eq("id", request.application_id).single(),
  ]);
  if (!referee || !application) return null;
  const { data: vacancy } = await admin.from("hr_vacancies").select("*").eq("id", application.vacancy_id).single();
  const { data: campus } = await admin.from("campuses").select("*").eq("id", application.campus_id).single();
  if (!vacancy || !campus) return null;
  return { request, referee, application, vacancy, campus };
}

export type ReferenceContext = NonNullable<Awaited<ReturnType<typeof loadRequest>>>;

export { loadRequest as loadReferenceRequest };

/** The first email, or a reminder. Mints a fresh link each time: the raw token lives only in the email. */
export async function emailReferee(
  admin: AdminClient,
  requestId: string,
  kind: "request" | "reminder" | "final_reminder"
): Promise<{ status: "done" } | { status: "skipped"; reason: string }> {
  const ctx = await loadRequest(admin, requestId);
  if (!ctx) return { status: "skipped", reason: "reference request missing" };
  const { request, referee, application, vacancy } = ctx;
  if (!["pending", "sent", "opened"].includes(request.status)) return { status: "skipped", reason: `reference is ${request.status}` };
  if (application.status !== "submitted") return { status: "skipped", reason: `application is ${application.status}` };
  if (!request.expires_at) return { status: "skipped", reason: "no expiry set" };

  const expiresAt = new Date(request.expires_at);
  const ttlDays = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000));
  const { url } = await mintToken(admin, { purpose: "reference", referenceRequestId: request.id }, { ttlDays, reason: kind });
  const key = kind === "request" ? "hr_reference_request" : kind === "reminder" ? "hr_reference_reminder" : "hr_reference_final_reminder";
  const sent = await sendTemplate(admin, {
    key,
    to: referee.email,
    vars: {
      referee_name: referee.full_name,
      applicant_full_name: fullName(application),
      vacancy_title: vacancy.title,
      link: url,
      expires_on: formatDate(expiresAt),
    },
    applicationId: application.id,
    referenceRequestId: request.id,
    idempotencyKey: `hr-ref-${request.id}-${kind}-${request.reminders_sent}`,
  });
  if (!sent.ok) {
    if (sent.retryable) throw new Error(sent.error);
    return { status: "skipped", reason: sent.error };
  }
  const now = new Date().toISOString();
  const { error } = await admin
    .from("hr_reference_requests")
    .update(
      kind === "request"
        ? { status: request.status === "pending" ? "sent" : request.status, sent_at: request.sent_at ?? now }
        : { reminders_sent: request.reminders_sent + 1 }
    )
    .eq("id", request.id);
  if (error) throw new Error(error.message);
  return { status: "done" };
}

export async function expireReference(admin: AdminClient, requestId: string): Promise<{ status: "done" } | { status: "skipped"; reason: string }> {
  const ctx = await loadRequest(admin, requestId);
  if (!ctx) return { status: "skipped", reason: "reference request missing" };
  if (!["pending", "sent", "opened"].includes(ctx.request.status)) return { status: "skipped", reason: `reference is ${ctx.request.status}` };
  const { error } = await admin.from("hr_reference_requests").update({ status: "expired" }).eq("id", requestId);
  if (error) throw new Error(error.message);
  await revokeReferenceTokens(admin, requestId);
  await enqueue(admin, [
    { type: "score_recompute", payload: { application_id: ctx.application.id }, key: `score:${ctx.application.id}:ref-expired:${requestId}` },
    {
      type: "staff_alert",
      payload: {
        key: "hr_staff_reference_expired",
        application_id: ctx.application.id,
        permission: "hr.recruitment.write",
        vars: {
          referee_name: ctx.referee.full_name,
          applicant_full_name: fullName(ctx.application),
          application_reference: ctx.application.reference,
          staff_link: `${siteUrl()}/staff/recruitment/applications/${ctx.application.id}`,
        },
      },
      key: `alert:ref-expired:${requestId}`,
    },
  ]);
  return { status: "done" };
}

/** Records that the referee opened the form. Once, and only from "sent". */
export async function markOpened(admin: AdminClient, requestId: string): Promise<void> {
  await admin.from("hr_reference_requests").update({ status: "opened", opened_at: new Date().toISOString() }).eq("id", requestId).eq("status", "sent");
}

export async function declineReference(admin: AdminClient, requestId: string, reason: string, ipHash: string | null): Promise<void> {
  const ctx = await loadRequest(admin, requestId);
  if (!ctx) throw new HrError("This reference link is no longer valid.");
  if (!["pending", "sent", "opened"].includes(ctx.request.status)) throw new HrError("This reference has already been answered.");
  const { error } = await admin
    .from("hr_reference_requests")
    .update({ status: "declined", declined_reason: reason.slice(0, 1000) || null })
    .eq("id", requestId);
  if (error) throw new Error(error.message);
  await revokeReferenceTokens(admin, requestId);
  const actor: Actor = { type: "referee", id: requestId, label: ctx.referee.email };
  await audit(admin, actor, {
    action: "reference_declined",
    entityType: "hr_reference_request",
    entityId: requestId,
    campusId: ctx.application.campus_id,
    applicationId: ctx.application.id,
    ipHash,
  });
  await enqueue(admin, [{ type: "score_recompute", payload: { application_id: ctx.application.id }, key: `score:${ctx.application.id}:ref-declined:${requestId}` }]);
}

export async function submitReference(admin: AdminClient, requestId: string, form: ReferenceForm, ipHash: string | null): Promise<void> {
  const ctx = await loadRequest(admin, requestId);
  if (!ctx) throw new HrError("This reference link is no longer valid.");
  const { request, referee, application, vacancy, campus } = ctx;
  if (!["pending", "sent", "opened"].includes(request.status)) throw new HrError("This reference has already been answered. Thank you.");

  const monthStart = (v: string | undefined) => (v ? (v.length === 7 ? `${v}-01` : v) : null);
  const { error } = await admin.from("hr_reference_responses").insert({
    request_id: request.id,
    application_id: application.id,
    capacity: form.capacity,
    known_from: monthStart(form.known_from || undefined),
    known_to: monthStart(form.known_to || undefined),
    role_and_dates_confirmed: form.role_and_dates_confirmed === "yes",
    role_and_dates_note: form.role_and_dates_note?.trim() || null,
    ratings: form.ratings as unknown as Json,
    concern: form.concern === "yes",
    concern_detail: form.concern === "yes" ? form.concern_detail?.trim() || null : null,
    reason_for_leaving: form.reason_for_leaving?.trim() || null,
    would_reemploy: form.would_reemploy,
    recommendation: form.recommendation,
    comments: form.comments?.trim() || null,
    referee_name_confirmed: form.referee_name_confirmed,
    ip_hash: ipHash,
  });
  if (error) {
    if (error.code === "23505") throw new HrError("This reference has already been answered. Thank you.");
    throw new Error(error.message);
  }
  const { error: updateError } = await admin
    .from("hr_reference_requests")
    .update({ status: "received", received_at: new Date().toISOString() })
    .eq("id", request.id);
  if (updateError) throw new Error(updateError.message);
  await revokeReferenceTokens(admin, request.id);

  await admin.from("hr_application_events").insert({
    application_id: application.id,
    kind: "reference_received",
    detail: { referee: referee.full_name, concern: form.concern === "yes" } as Json,
    actor_type: "referee",
  });
  await audit(admin, { type: "referee", id: request.id, label: referee.email }, {
    action: "reference_submitted",
    entityType: "hr_reference_request",
    entityId: request.id,
    campusId: application.campus_id,
    applicationId: application.id,
    ipHash,
  });

  const staffLink = `${siteUrl()}/staff/recruitment/applications/${application.id}`;
  const { data: siblings } = await admin.from("hr_reference_requests").select("status").eq("application_id", application.id);
  const allIn = (siblings ?? []).every((s) => !["pending", "sent", "opened"].includes(s.status));

  await enqueue(admin, [
    { type: "score_recompute", payload: { application_id: application.id }, key: `score:${application.id}:ref:${request.id}` },
    {
      type: "send_email",
      payload: {
        key: "hr_reference_thank_you",
        to: referee.email,
        vars: { referee_name: referee.full_name, applicant_full_name: fullName(application) },
        application_id: application.id,
        reference_request_id: request.id,
      },
      key: `email:ref-thanks:${request.id}`,
    },
    ...(form.concern === "yes"
      ? [
          {
            type: "staff_alert" as const,
            payload: {
              key: "hr_staff_reference_concern",
              application_id: application.id,
              permission: "hr.recruitment.hire",
              vars: { application_reference: application.reference, vacancy_title: vacancy.title, campus: campus.name, staff_link: staffLink },
            },
            key: `alert:ref-concern:${request.id}`,
          },
        ]
      : []),
    ...(allIn
      ? [
          {
            type: "staff_alert" as const,
            payload: {
              key: "hr_staff_references_complete",
              application_id: application.id,
              permission: "hr.recruitment.write",
              vars: {
                applicant_full_name: fullName(application),
                application_reference: application.reference,
                vacancy_title: vacancy.title,
                staff_link: staffLink,
              },
            },
            key: `alert:refs-complete:${application.id}`,
          },
        ]
      : []),
  ]);
}

