"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { loadApplicationGraph } from "@/lib/applications";
import { parseMismatchFlags } from "@/lib/documents/compare";
import { isExtractable } from "@/lib/documents/extraction-schemas";
import { getDocumentExtractor } from "@/lib/documents/extractor";
import { DocumentError, storeDocument } from "@/lib/documents/storage";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { loadRegistrationBundle } from "@/lib/registration/load";
import { applicableRequirements, missingDocumentsText, registrationCompleteness } from "@/lib/registration/completeness";
import { drainSoon, guarded, loadApplicationForStaff } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import { startParentSession } from "@/lib/tokens/server";
import { commit, enqueueJobs, WorkflowError } from "@/lib/workflow/engine";
import { onEnrolmentConfirmed } from "@/lib/workflow/enrolment-actions";
import { onDocumentReviewed, onDocumentUploaded, onMismatchConfirmationRequested, onRegistrationConfirmedByStaff, registrationReminderKey } from "@/lib/workflow/registration-actions";

function done(applicationId: string) {
  revalidatePath("/staff/registrations");
  revalidatePath(`/staff/registrations/${applicationId}`);
  revalidatePath(`/staff/applications/${applicationId}`);
  revalidatePath("/staff/tasks");
  revalidatePath("/staff");
}

export async function reviewDocument(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const p = z.object({ applicationId: z.guid(), documentId: z.guid(), status: z.enum(["accepted", "rejected"]), note: z.string().trim().max(300).optional() }).parse(Object.fromEntries(formData));
    if (p.status === "rejected" && !p.note) throw new WorkflowError("Tell the parent why the document was not accepted.", "database");
    const { admin, app } = await loadApplicationForStaff(ctx, p.applicationId);
    const { data: document } = await admin.from("documents").select("*").eq("id", p.documentId).eq("application_id", app.id).maybeSingle();
    if (!document) throw new WorkflowError("Document not found.", "application_not_found");
    await onDocumentReviewed(admin, app, document, { status: p.status, note: p.note || null }, ctx.actor);
    drainSoon();
    done(app.id);
  });
}

export async function confirmEnrolment(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const p = z.object({ applicationId: z.guid() }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, p.applicationId);
    const graph = await loadApplicationGraph(admin, app.id);
    if (!graph) throw new WorkflowError("Application not found.", "application_not_found");
    await onEnrolmentConfirmed(admin, graph, ctx.actor);
    drainSoon();
    done(app.id);
  });
}

/**
 * A registration the parent filled in and never submitted (or finished after
 * submitting), confirmed by a person. Refused unless the completeness rule
 * agrees it is complete, and the message then says what is missing.
 */
export async function confirmRegistration(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const p = z.object({ applicationId: z.guid(), note: z.string().trim().max(500).optional() }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, p.applicationId);
    const graph = await loadApplicationGraph(admin, app.id);
    if (!graph) throw new WorkflowError("Application not found.", "application_not_found");
    const bundle = await loadRegistrationBundle(admin, graph);
    await onRegistrationConfirmedByStaff(admin, graph, bundle.completeness, p.note || null, ctx.actor);
    drainSoon();
    done(app.id);
  });
}

export async function sendRegistrationReminder(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const p = z.object({ applicationId: z.guid() }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, p.applicationId);
    if (app.status !== "registration_incomplete") throw new WorkflowError("Registration is not open on this application.", "status_conflict");
    const graph = await loadApplicationGraph(admin, app.id);
    if (!graph) throw new WorkflowError("Application not found.", "application_not_found");
    const bundle = await loadRegistrationBundle(admin, graph);
    const templateKey = await registrationReminderKey(admin, app.id);
    await commit(admin, {
      applicationId: app.id,
      expectedStatus: null,
      newStatus: null,
      nextAction: null,
      event: { type: "registration.reminder_sent", summary: "Registration reminder sent by staff", payload: {} },
      jobs: [
        {
          type: "send_email",
          payload: { template_key: templateKey, links: ["registration"], missing_documents: missingDocumentsText(bundle.completeness) },
          idempotencyKey: `email:${app.id}:${templateKey}:staff:${Math.floor(Date.now() / 3_600_000)}`,
        },
      ],
      actor: ctx.actor,
    });
    drainSoon();
    done(app.id);
  });
}

/** Read (or re-read) one document with the extractor. A proposal, never a change. */
export async function extractDocument(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const p = z.object({ applicationId: z.guid(), documentId: z.guid() }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, p.applicationId);
    if (getDocumentExtractor().name === "none") throw new WorkflowError("No document extractor is configured (DOCUMENT_EXTRACTOR).", "database");
    const { data: document } = await admin.from("documents").select("id, requirement_code").eq("id", p.documentId).eq("application_id", app.id).is("superseded_by", null).maybeSingle();
    if (!document) throw new WorkflowError("Document not found.", "application_not_found");
    if (!isExtractable(document.requirement_code)) throw new WorkflowError("That kind of document is not read.", "database");
    const verdict = await enforceRateLimit(admin, LIMITS.extraction, ctx.userId);
    if (!verdict.ok) throw new WorkflowError("Too many readings in a short time. Please wait a little.", "database");
    await enqueueJobs(admin, [{ type: "document_extract", applicationId: app.id, payload: { document_id: document.id }, idempotencyKey: `extract:${document.id}:${Math.floor(Date.now() / 60_000)}` }]);
    drainSoon();
    done(app.id);
  });
}

/** Email the parent the flagged details and ask them to check the form against the document. */
export async function askParentToConfirm(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const p = z.object({ applicationId: z.guid() }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, p.applicationId);
    const { data: registration } = await admin.from("registrations").select("mismatch_flags").eq("application_id", app.id).maybeSingle();
    await onMismatchConfirmationRequested(admin, app, parseMismatchFlags(registration?.mismatch_flags), ctx.actor);
    drainSoon();
    done(app.id);
  });
}

/**
 * A document the parent could not upload themselves, put in by the office.
 *
 * Families send things by WhatsApp, by email, or hand a folder across the
 * desk, and until now that left the registration stuck behind a tick nobody
 * could give. The file goes to exactly the same place, through the same scan
 * and the same supersede rule as a parent's own upload; the row records that
 * a member of staff put it there and which one, so the record does not
 * pretend the parent did it.
 */
export async function uploadDocumentForParent(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const parsed = z
      .object({ applicationId: z.guid(), requirement: z.string().trim().min(1).max(64) })
      .parse({ applicationId: formData.get("applicationId"), requirement: formData.get("requirement") });
    const { admin } = await loadApplicationForStaff(ctx, parsed.applicationId);

    const graph = await loadApplicationGraph(admin, parsed.applicationId);
    if (!graph) throw new Error("That applicant no longer exists.");
    const bundle = await loadRegistrationBundle(admin, graph);
    const applicable = applicableRequirements(bundle.requirements, graph.grade.sort_order).find((q) => q.code === parsed.requirement);
    if (!applicable) throw new Error("That document is not asked for at this stage.");

    const verdict = await enforceRateLimit(admin, LIMITS.documentUpload, parsed.applicationId);
    if (!verdict.ok) throw new Error("Too many uploads for this applicant in a short time. Try again shortly.");

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a file to upload.");
    const bytes = new Uint8Array(await file.arrayBuffer());

    let document;
    try {
      document = await storeDocument(admin, {
        applicationId: parsed.applicationId,
        requirementCode: parsed.requirement,
        bytes,
        originalFilename: file.name,
        uploadedBy: "staff",
        staffId: ctx.userId,
      });
    } catch (e) {
      if (e instanceof DocumentError) {
        throw new Error(
          e.code === "too_large" ? "That file is too big." :
          e.code === "bad_type" ? "That file type is not accepted. Use a PDF, JPEG or PNG." :
          e.code === "empty" ? "That file is empty." :
          "The upload failed. Try again."
        );
      }
      throw e;
    }

    const after = await loadRegistrationBundle(admin, graph);
    await onDocumentUploaded(
      admin,
      graph.application,
      document,
      registrationCompleteness({ ...after, gradeSort: graph.grade.sort_order }),
      ctx.actor
    );
    drainSoon();
    done(parsed.applicationId);
  });
}

/** Long enough to sit with a family through every step and the documents, short enough not to outlive the visit. */
const ASSISTED_MINUTES = 60;

/**
 * Open the family's registration form in this browser, to fill it in with
 * them at the desk or for them from what they have given the school.
 *
 * Asked for by the school on 22 October 2026. Until now the only way was to
 * generate the parent's link and paste it in, and then every answer, upload
 * and signature was recorded as the parent's own, from the school's
 * computer. This opens the same form — the same steps, checks and
 * completeness rule, so nothing a parent is held to is skipped — under a
 * session that names the member of staff. Every save goes on the timeline
 * as theirs, uploads are recorded as staff uploads, and a signature drawn
 * at the desk says who was there (`agreement_acceptances.witnessed_by_staff_id`).
 *
 * No token is minted: the cookie is set here, after the same permission and
 * campus checks as every other action on the registration, so there is no
 * reusable link left in the browser's history. It is the parent cookie, so it
 * names this one application and nothing else, and "Finish" on the form ends
 * it.
 */
export async function startAssistedRegistration(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  // `redirect` throws and `guarded` would catch it, so the redirect happens
  // after the guard, as Delete applicant does.
  let opened: string | null = null;
  const state = await guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const p = z.object({ applicationId: z.guid() }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, p.applicationId);
    if (app.status !== "registration_incomplete") {
      throw new WorkflowError("The registration is not open: it is only filled in after the fees are paid, and until it is submitted.", "status_conflict");
    }
    await commit(admin, {
      applicationId: app.id,
      expectedStatus: app.status,
      newStatus: null,
      nextAction: null,
      event: { type: "registration.assisted_started", summary: "Opened the registration form to fill in with the family", payload: {} },
      audit: { action: "registration.assisted_started", entityType: "application", entityId: app.id },
      actor: ctx.actor,
    });
    await startParentSession(app.id, "registration", ASSISTED_MINUTES, { assistedBy: ctx.userId });
    opened = app.id;
  });
  if (opened) redirect("/register");
  return state;
}
