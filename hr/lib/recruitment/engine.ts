import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { HrApplicationRow, Json, PipelineStage } from "@/lib/supabase/types";
import { audit, SYSTEM, type Actor } from "@/lib/audit";
import { HrError, STALE_MESSAGE } from "@/lib/errors";
import { formatDate } from "@/lib/format-date";
import { daysFrom, enqueue, type Enqueue } from "@/lib/jobs/queue";
import { SECTIONS } from "@/lib/applicant/schemas";
import { vacancyIsOpen } from "@/lib/applicant/scope";
import { fullName } from "@/lib/recruitment/bundle";
import { getHrSettings } from "@/lib/settings";
import { mintToken, revokeApplicationTokens } from "@/lib/tokens";

/**
 * The recruitment engine: everything that changes what an application *is*.
 *
 * `submitApplication` sets the first stage, and `moveStage` (through the
 * `hr_commit_stage()` compare-and-set) is the only other writer of
 * `hr_applications.stage`. Nothing else may update it; if you find yourself
 * writing `.update({ stage })` elsewhere, stop.
 *
 * Emails are queued, never sent inline, so a slow provider never fails the
 * click that caused them and a retried request never sends twice.
 */

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Starting and resuming
// ---------------------------------------------------------------------------

export async function startApplication(
  admin: AdminClient,
  input: { vacancyId: string; firstName: string; lastName: string; email: string; talentPool: boolean }
): Promise<{ kind: "created"; applicationId: string } | { kind: "existing" }> {
  const { data: vacancy } = await admin.from("hr_vacancies").select("*").eq("id", input.vacancyId).maybeSingle();
  if (!vacancy || !vacancyIsOpen(vacancy)) throw new HrError("This vacancy is no longer open for applications.");
  const settings = await getHrSettings(admin);
  const email = normaliseEmail(input.email);

  const { data: existing } = await admin
    .from("hr_applications")
    .select("id, status")
    .eq("vacancy_id", vacancy.id)
    .eq("email_normalised", email)
    .in("status", ["draft", "submitted"])
    .maybeSingle();
  if (existing) {
    // Never open somebody else's application from a typed email address: the
    // link goes to the address on file, and only that inbox can use it.
    await queueContinueLink(admin, existing.id, "existing");
    return { kind: "existing" };
  }

  const { data: created, error } = await admin
    .from("hr_applications")
    .insert({
      reference: "",
      vacancy_id: vacancy.id,
      campus_id: vacancy.campus_id,
      email: input.email.trim(),
      email_normalised: email,
      first_name: input.firstName,
      last_name: input.lastName,
      privacy_notice_version: settings.privacyNoticeVersion,
      consented_at: new Date().toISOString(),
      talent_pool_consent: input.talentPool,
      retention_due_at: daysFrom(new Date(), settings.draftExpiryDays).toISOString(),
    })
    .select("id")
    .single();
  if (error || !created) {
    if (error?.code === "23505") {
      await queueContinueLink(admin, null, "existing", { vacancyId: vacancy.id, email });
      return { kind: "existing" };
    }
    throw new Error(error?.message ?? "Could not start the application");
  }
  await admin.from("hr_application_events").insert({ application_id: created.id, kind: "started", actor_type: "applicant" });
  await queueContinueLink(admin, created.id, "start");
  return { kind: "created", applicationId: created.id };
}

/** Emails a fresh "continue your application" link. Same reply whether or not the address is known. */
export async function requestFreshLink(admin: AdminClient, email: string): Promise<void> {
  const { data } = await admin
    .from("hr_applications")
    .select("id")
    .eq("email_normalised", normaliseEmail(email))
    .in("status", ["draft", "submitted"])
    .order("created_at", { ascending: false })
    .limit(3);
  for (const row of data ?? []) await queueContinueLink(admin, row.id, `fresh-${Date.now()}`);
}

async function queueContinueLink(
  admin: AdminClient,
  applicationId: string | null,
  reason: string,
  lookup?: { vacancyId: string; email: string }
): Promise<void> {
  let id = applicationId;
  if (!id && lookup) {
    const { data } = await admin
      .from("hr_applications")
      .select("id")
      .eq("vacancy_id", lookup.vacancyId)
      .eq("email_normalised", lookup.email)
      .in("status", ["draft", "submitted"])
      .maybeSingle();
    id = data?.id ?? null;
  }
  if (!id) return;
  const { data: app } = await admin.from("hr_applications").select("*").eq("id", id).single();
  if (!app) return;
  const [{ data: vacancy }, { data: campus }] = await Promise.all([
    admin.from("hr_vacancies").select("title").eq("id", app.vacancy_id).single(),
    admin.from("campuses").select("name").eq("id", app.campus_id).single(),
  ]);
  const settings = await getHrSettings(admin);
  const { url, expiresAt } = await mintToken(admin, { purpose: "application", applicationId: id }, { ttlDays: settings.draftExpiryDays, reason });
  await enqueue(admin, [
    {
      type: "send_email",
      payload: {
        key: "hr_application_continue",
        to: app.email,
        vars: {
          applicant_first_name: app.first_name,
          vacancy_title: vacancy?.title ?? "",
          campus: campus?.name ?? "",
          link: url,
          link_expires_on: formatDate(expiresAt),
        },
        application_id: id,
      },
      key: `email:continue:${id}:${reason}:${expiresAt.getTime()}`,
    },
  ]);
}

// ---------------------------------------------------------------------------
// Submitting
// ---------------------------------------------------------------------------

export function missingSections(app: Pick<HrApplicationRow, "sections_completed">): string[] {
  const done = new Set(app.sections_completed);
  return SECTIONS.filter((s) => !done.has(s));
}

export async function submitApplication(admin: AdminClient, applicationId: string, ipHash: string | null): Promise<void> {
  const { data: app, error } = await admin.from("hr_applications").select("*").eq("id", applicationId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!app) throw new HrError("We could not find your application.");
  if (app.status !== "draft") throw new HrError("Your application has already been sent.");
  const { data: vacancy } = await admin.from("hr_vacancies").select("*").eq("id", app.vacancy_id).single();
  if (!vacancy || !vacancyIsOpen(vacancy)) throw new HrError("This vacancy has closed, so the application cannot be sent.");
  const missing = missingSections(app);
  if (missing.length) throw new HrError("Please finish every section before you send your application.");
  if (!app.integrity_notice_accepted_at) throw new HrError("Please confirm that you wrote the answers yourself.");

  const settings = await getHrSettings(admin);
  const { data: referees } = await admin.from("hr_referees").select("id").eq("application_id", app.id);
  if (!referees || referees.length < settings.minReferees) throw new HrError(`Please give at least ${settings.minReferees} referees.`);

  const now = new Date();
  // Status and the first stage together, guarded on still being a draft so a
  // double click submits once.
  const { data: updated, error: updateError } = await admin
    .from("hr_applications")
    .update({ status: "submitted", stage: "review", submitted_at: now.toISOString(), stage_changed_at: now.toISOString(), retention_due_at: null })
    .eq("id", app.id)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();
  if (updateError) throw new Error(updateError.message);
  if (!updated) throw new HrError("Your application has already been sent.");

  const expiresAt = daysFrom(now, settings.referenceExpiryDays);
  const { data: requests, error: requestError } = await admin
    .from("hr_reference_requests")
    .insert(referees.map((r) => ({ referee_id: r.id, application_id: app.id, expires_at: expiresAt.toISOString() })))
    .select("id");
  if (requestError) throw new Error(requestError.message);

  await admin.from("hr_application_events").insert({ application_id: app.id, kind: "submitted", actor_type: "applicant" });
  await audit(admin, { type: "applicant", id: app.id, label: app.email }, {
    action: "application_submitted",
    entityType: "hr_application",
    entityId: app.id,
    campusId: app.campus_id,
    applicationId: app.id,
    ipHash,
  });

  const { data: campus } = await admin.from("campuses").select("name").eq("id", app.campus_id).single();
  const open = { reference_request_status: ["pending", "sent", "opened"] };
  const jobs: Enqueue[] = [
    {
      type: "send_email",
      payload: {
        key: "hr_application_received",
        to: app.email,
        vars: {
          applicant_first_name: app.first_name,
          vacancy_title: vacancy.title,
          campus: campus?.name ?? "",
          application_reference: app.reference,
          closes_on: vacancy.closes_on ? formatDate(vacancy.closes_on) : "the closing date",
        },
        application_id: app.id,
      },
      key: `email:received:${app.id}`,
    },
    { type: "ai_integrity_check", payload: { application_id: app.id }, key: `integrity:${app.id}` },
    { type: "ai_mark_application", payload: { application_id: app.id }, key: `mark:${app.id}` },
    { type: "score_recompute", payload: { application_id: app.id }, key: `score:${app.id}:submitted` },
  ];
  for (const r of requests ?? []) {
    jobs.push({ type: "reference_send", payload: { reference_request_id: r.id }, key: `ref:${r.id}:request`, precondition: { reference_request_id: r.id, ...open } });
    settings.referenceReminderDays.forEach((day, i) => {
      jobs.push({
        type: "reference_remind",
        payload: { reference_request_id: r.id, final: i === settings.referenceReminderDays.length - 1 && i > 0 },
        key: `ref:${r.id}:remind:${i + 1}`,
        runAfter: daysFrom(now, day),
        precondition: { reference_request_id: r.id, ...open },
      });
    });
    jobs.push({
      type: "reference_expire",
      payload: { reference_request_id: r.id },
      key: `ref:${r.id}:expire`,
      runAfter: expiresAt,
      precondition: { reference_request_id: r.id, ...open },
    });
  }
  await enqueue(admin, jobs);
}

export async function withdrawApplication(admin: AdminClient, applicationId: string): Promise<void> {
  const { data: app } = await admin.from("hr_applications").select("*").eq("id", applicationId).maybeSingle();
  if (!app || !["draft", "submitted"].includes(app.status)) throw new HrError("This application cannot be withdrawn.");
  const settings = await getHrSettings(admin);
  const months = app.talent_pool_consent ? settings.talentPoolRetentionMonths : settings.unsuccessfulRetentionMonths;
  if (app.status === "submitted") {
    const { error } = await admin.rpc("hr_commit_stage", {
      p_application_id: app.id,
      p_expected_stage: app.stage,
      p_to_stage: app.stage ?? "review",
      p_reason: "Withdrawn by the applicant",
      p_actor_id: null,
      p_to_status: "withdrawn",
    });
    if (error) throw new Error(error.message);
  } else {
    await admin.from("hr_applications").update({ status: "withdrawn", withdrawn_at: new Date().toISOString() }).eq("id", app.id).eq("status", "draft");
  }
  await admin
    .from("hr_applications")
    .update({ retention_due_at: addMonths(new Date(), months).toISOString() })
    .eq("id", app.id);
  await admin.from("hr_reference_requests").update({ status: "declined", declined_reason: "Application withdrawn" }).eq("application_id", app.id).in("status", ["pending", "sent", "opened"]);
  await revokeApplicationTokens(admin, app.id);
  const { data: vacancy } = await admin.from("hr_vacancies").select("title").eq("id", app.vacancy_id).single();
  await enqueue(admin, [
    {
      type: "send_email",
      payload: { key: "hr_withdrawal_confirmed", to: app.email, vars: { applicant_first_name: app.first_name, vacancy_title: vacancy?.title ?? "" }, application_id: app.id },
      key: `email:withdrawn:${app.id}`,
    },
  ]);
}

export function addMonths(d: Date, months: number): Date {
  const out = new Date(d);
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

export const STAGE_LABELS: Record<PipelineStage, string> = {
  review: "Review",
  shortlisted: "Shortlisted",
  unsuccessful: "Unsuccessful",
};

/**
 * Moves an application between the three categories. Moving does not email
 * anyone unless the person asked for it with `notify`: news that a place has
 * gone to someone else is only ever sent by a person's click.
 */
export async function moveStage(
  admin: AdminClient,
  actor: Actor,
  input: { applicationId: string; expected: PipelineStage | null; to: PipelineStage; reason: string | null; notify: boolean }
): Promise<HrApplicationRow> {
  const { data, error } = await admin.rpc("hr_commit_stage", {
    p_application_id: input.applicationId,
    p_expected_stage: input.expected,
    p_to_stage: input.to,
    p_reason: input.reason,
    p_actor_id: actor.id,
  });
  if (error) {
    if (error.message.includes("stale_stage")) throw new HrError(STALE_MESSAGE, "stale");
    if (error.message.includes("application_not_open")) throw new HrError("This application is closed and cannot be moved.");
    throw new Error(error.message);
  }
  const app = data as HrApplicationRow;

  const settings = await getHrSettings(admin);
  const retention =
    input.to === "unsuccessful"
      ? addMonths(new Date(), app.talent_pool_consent ? settings.talentPoolRetentionMonths : settings.unsuccessfulRetentionMonths).toISOString()
      : null;
  await admin.from("hr_applications").update({ retention_due_at: retention }).eq("id", app.id);

  await audit(admin, actor, {
    action: "stage_changed",
    entityType: "hr_application",
    entityId: app.id,
    campusId: app.campus_id,
    applicationId: app.id,
    before: { stage: input.expected } as Json,
    after: { stage: input.to, reason: input.reason } as Json,
  });

  if (input.notify && input.to !== "review") {
    const { data: vacancy } = await admin.from("hr_vacancies").select("title").eq("id", app.vacancy_id).single();
    const { data: campus } = await admin.from("campuses").select("name").eq("id", app.campus_id).single();
    await enqueue(admin, [
      {
        type: "send_email",
        payload: {
          key: input.to === "shortlisted" ? "hr_shortlisted" : "hr_unsuccessful",
          to: app.email,
          vars: {
            applicant_first_name: app.first_name,
            vacancy_title: vacancy?.title ?? "",
            campus: campus?.name ?? "",
            talent_pool: app.talent_pool_consent ? "yes" : "",
          },
          application_id: app.id,
        },
        key: `email:${input.to}:${app.id}:${app.stage_changed_at}`,
        precondition: { application_id: app.id, application_stage: [input.to], application_status: ["submitted"] },
      },
    ]);
  }
  return app;
}

/** Offers the post. A person's click; the contract follows outside the system. */
export async function sendOffer(admin: AdminClient, actor: Actor, applicationId: string, note: string | null): Promise<void> {
  const { data: app } = await admin.from("hr_applications").select("*").eq("id", applicationId).single();
  if (!app || app.status !== "submitted" || app.stage !== "shortlisted") throw new HrError("Only a shortlisted applicant can be offered the post.");
  const [{ data: vacancy }, { data: campus }] = await Promise.all([
    admin.from("hr_vacancies").select("title").eq("id", app.vacancy_id).single(),
    admin.from("campuses").select("name").eq("id", app.campus_id).single(),
  ]);
  await admin.from("hr_application_events").insert({
    application_id: app.id,
    kind: "offer_sent",
    detail: { note } as Json,
    actor_type: "staff",
    actor_id: actor.id,
  });
  await audit(admin, actor, { action: "offer_sent", entityType: "hr_application", entityId: app.id, campusId: app.campus_id, applicationId: app.id });
  await enqueue(admin, [
    {
      type: "send_email",
      payload: {
        key: "hr_offer",
        to: app.email,
        vars: { applicant_first_name: app.first_name, vacancy_title: vacancy?.title ?? "", campus: campus?.name ?? "", offer_note: note ?? "" },
        application_id: app.id,
      },
      key: `email:offer:${app.id}:${Date.now()}`,
    },
  ]);
}

/** Marks a shortlisted applicant hired. The employee record is created by `lib/employees/hire.ts`. */
export async function markHired(admin: AdminClient, actor: Actor, app: HrApplicationRow): Promise<void> {
  const { error } = await admin.rpc("hr_commit_stage", {
    p_application_id: app.id,
    p_expected_stage: app.stage,
    p_to_stage: "shortlisted",
    p_reason: "Hired",
    p_actor_id: actor.id,
    p_to_status: "hired",
  });
  if (error) {
    if (error.message.includes("hire_needs_shortlist")) throw new HrError("Move the applicant to Shortlisted before hiring them.");
    if (error.message.includes("stale_stage")) throw new HrError(STALE_MESSAGE, "stale");
    throw new Error(error.message);
  }
  await audit(admin, actor, { action: "hired", entityType: "hr_application", entityId: app.id, campusId: app.campus_id, applicationId: app.id });
}

export { fullName, SYSTEM };
