import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { sendTemplate } from "@/lib/email/send";
import { buildIcs } from "@/lib/email/ics";
import { formatDateTime } from "@/lib/format-date";
import type { JobSpec } from "@/lib/jobs/queue";
import { checkIntegrity, markApplication } from "@/lib/recruitment/marking";
import { emailReferee, expireReference } from "@/lib/references";
import { recomputeScore } from "@/lib/scoring/recompute";
import { staffWithPermission } from "@/lib/staff/recipients";

export type HandlerOutcome = { status: "done" } | { status: "skipped"; reason: string };

/** A failure the drain should retry with backoff. Anything else thrown is retried too. */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

type Handler<T extends JobSpec["type"]> = (
  admin: AdminClient,
  payload: Extract<JobSpec, { type: T }>["payload"],
  job: { id: string; idempotency_key: string }
) => Promise<HandlerOutcome>;

const MODE_LABEL = { in_person: "In person", video: "Video call", phone: "Phone call" } as const;

export const HANDLERS: { [K in JobSpec["type"]]: Handler<K> } = {
  async send_email(admin, p, job) {
    const sent = await sendTemplate(admin, {
      key: p.key,
      to: p.to,
      vars: p.vars,
      applicationId: p.application_id ?? null,
      referenceRequestId: p.reference_request_id ?? null,
      employeeId: p.employee_id ?? null,
      idempotencyKey: job.idempotency_key,
    });
    if (!sent.ok) {
      if (sent.retryable) throw new Error(sent.error);
      throw new PermanentJobError(sent.error);
    }
    return { status: "done" };
  },

  reference_send: (admin, p) => emailReferee(admin, p.reference_request_id, "request"),
  reference_remind: (admin, p) => emailReferee(admin, p.reference_request_id, p.final ? "final_reminder" : "reminder"),
  reference_expire: (admin, p) => expireReference(admin, p.reference_request_id),

  async ai_mark_application(admin, p) {
    const outcome = await markApplication(admin, p.application_id);
    await recomputeScore(admin, p.application_id);
    return outcome;
  },

  async ai_integrity_check(admin, p) {
    const outcome = await checkIntegrity(admin, p.application_id);
    await recomputeScore(admin, p.application_id);
    return outcome;
  },

  async score_recompute(admin, p) {
    const result = await recomputeScore(admin, p.application_id);
    return result ? { status: "done" } : { status: "skipped", reason: "application is not live" };
  },

  async interview_email(admin, p, job) {
    const { data: interview } = await admin.from("hr_interviews").select("*").eq("id", p.interview_id).maybeSingle();
    if (!interview) return { status: "skipped", reason: "interview missing" };
    const { data: application } = await admin.from("hr_applications").select("*").eq("id", interview.application_id).single();
    if (!application || application.status !== "submitted") return { status: "skipped", reason: "application is not open" };
    if (p.kind !== "cancelled" && interview.status !== "scheduled") return { status: "skipped", reason: `interview is ${interview.status}` };
    const { data: vacancy } = await admin.from("hr_vacancies").select("title").eq("id", application.vacancy_id).single();
    const { data: campus } = await admin.from("campuses").select("name, address").eq("id", interview.campus_id).single();

    const where = interview.location || (interview.mode === "in_person" ? [campus?.name, campus?.address].filter(Boolean).join(", ") : "We will send you the link");
    const ics = buildIcs({
      uid: interview.ics_uid,
      summary: `Interview: ${vacancy?.title ?? "Hibiscus International Schools"}`,
      description: `Your interview with Hibiscus International Schools. ${MODE_LABEL[interview.mode]}.`,
      location: where,
      startsAt: new Date(interview.starts_at),
      endsAt: new Date(interview.ends_at),
      sequence: interview.ics_sequence,
      cancelled: p.kind === "cancelled",
    });
    const key = p.kind === "invite" ? "hr_interview_invite" : p.kind === "changed" ? "hr_interview_changed" : "hr_interview_cancelled";
    const sent = await sendTemplate(admin, {
      key,
      to: application.email,
      vars: {
        applicant_first_name: application.first_name,
        vacancy_title: vacancy?.title ?? "",
        interview_when: formatDateTime(interview.starts_at),
        interview_mode: MODE_LABEL[interview.mode],
        interview_where: where,
      },
      applicationId: application.id,
      attachments: [{ filename: "interview.ics", content: ics, contentType: "text/calendar; charset=utf-8" }],
      idempotencyKey: job.idempotency_key,
    });
    if (!sent.ok) {
      if (sent.retryable) throw new Error(sent.error);
      throw new PermanentJobError(sent.error);
    }
    return { status: "done" };
  },

  async staff_alert(admin, p, job) {
    const { data: application } = await admin.from("hr_applications").select("campus_id").eq("id", p.application_id).maybeSingle();
    if (!application) return { status: "skipped", reason: "application missing" };
    const recipients = await staffWithPermission(admin, p.permission, application.campus_id);
    if (!recipients.length) return { status: "skipped", reason: `nobody holds ${p.permission} at this campus` };
    for (const r of recipients) {
      const sent = await sendTemplate(admin, {
        key: p.key,
        to: r.email,
        vars: p.vars,
        applicationId: p.application_id,
        idempotencyKey: `${job.idempotency_key}:${r.id}`,
      });
      if (!sent.ok && sent.retryable) throw new Error(sent.error);
    }
    return { status: "done" };
  },
};
