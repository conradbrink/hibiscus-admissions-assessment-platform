"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { loadApplicationGraph } from "@/lib/applications";
import { parseMismatchFlags } from "@/lib/documents/compare";
import { isExtractable } from "@/lib/documents/extraction-schemas";
import { getDocumentExtractor } from "@/lib/documents/extractor";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { loadRegistrationBundle } from "@/lib/registration/load";
import { missingDocumentsText } from "@/lib/registration/completeness";
import { drainSoon, guarded, loadApplicationForStaff } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import { commit, enqueueJobs, WorkflowError } from "@/lib/workflow/engine";
import { onEnrolmentConfirmed } from "@/lib/workflow/enrolment-actions";
import { onDocumentReviewed, onMismatchConfirmationRequested } from "@/lib/workflow/registration-actions";

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
    const p = z.object({ applicationId: z.uuid(), documentId: z.uuid(), status: z.enum(["accepted", "rejected"]), note: z.string().trim().max(300).optional() }).parse(Object.fromEntries(formData));
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
    const p = z.object({ applicationId: z.uuid() }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, p.applicationId);
    const graph = await loadApplicationGraph(admin, app.id);
    if (!graph) throw new WorkflowError("Application not found.", "application_not_found");
    await onEnrolmentConfirmed(admin, graph, ctx.actor);
    drainSoon();
    done(app.id);
  });
}

export async function sendRegistrationReminder(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const p = z.object({ applicationId: z.uuid() }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, p.applicationId);
    if (app.status !== "registration_incomplete") throw new WorkflowError("Registration is not open on this application.", "status_conflict");
    const graph = await loadApplicationGraph(admin, app.id);
    if (!graph) throw new WorkflowError("Application not found.", "application_not_found");
    const bundle = await loadRegistrationBundle(admin, graph);
    await commit(admin, {
      applicationId: app.id,
      expectedStatus: null,
      newStatus: null,
      nextAction: null,
      event: { type: "registration.reminder_sent", summary: "Registration reminder sent by staff", payload: {} },
      jobs: [
        {
          type: "send_email",
          payload: { template_key: "registration_reminder", links: ["registration"], missing_documents: missingDocumentsText(bundle.completeness) },
          idempotencyKey: `email:${app.id}:registration_reminder:staff:${Math.floor(Date.now() / 3_600_000)}`,
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
    const p = z.object({ applicationId: z.uuid(), documentId: z.uuid() }).parse(Object.fromEntries(formData));
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
    const p = z.object({ applicationId: z.uuid() }).parse(Object.fromEntries(formData));
    const { admin, app } = await loadApplicationForStaff(ctx, p.applicationId);
    const { data: registration } = await admin.from("registrations").select("mismatch_flags").eq("application_id", app.id).maybeSingle();
    await onMismatchConfirmationRequested(admin, app, parseMismatchFlags(registration?.mismatch_flags), ctx.actor);
    drainSoon();
    done(app.id);
  });
}
