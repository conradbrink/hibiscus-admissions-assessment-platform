import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { ApplicationGraph } from "@/lib/applications";
import { isExtractable } from "@/lib/documents/extraction-schemas";
import { mismatchText, parseMismatchFlags, type MismatchFlag } from "@/lib/documents/compare";
import { missingDocumentsText, type Completeness } from "@/lib/registration/completeness";
import { getSettings } from "@/lib/settings";
import type { ApplicationRow, DocumentRow, Json } from "@/lib/supabase/types";
import { commit, SYSTEM_ACTOR, WorkflowError, type Actor, type JobSpec, type TaskSpec } from "@/lib/workflow/engine";

/**
 * Registration through the engine: every save is a timeline event, a
 * change to what the application already held is a task, an upload or a
 * review is recorded, and submission moves the application only when the
 * registration is complete.
 */

/**
 * A section was saved. Pure event; a change to the child's name or date of
 * birth also opens a review task. Saving the student section answers any
 * document-mismatch flag: the parent has looked and decided.
 */
export async function onRegistrationSaved(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "child_first_name">,
  section: string,
  changedFields: string[],
  actor: Actor,
  opts: { clearedMismatch?: boolean } = {}
): Promise<void> {
  const tasks: TaskSpec[] = changedFields.length
    ? [
        {
          type: "review_registration_change",
          title: `${app.child_first_name}: registration differs from the application`,
          details: `The parent entered a different ${changedFields.map((f) => f.replace("child_", "").replace(/_/g, " ")).join(", ")} on the registration form. Check the birth certificate once uploaded and correct the application if needed.`,
          priority: "normal",
        },
      ]
    : [];
  await commit(admin, {
    applicationId: app.id,
    expectedStatus: null,
    newStatus: null,
    nextAction: null,
    event: { type: "registration.section_saved", summary: `Registration: ${section} saved${opts.clearedMismatch ? " (document check answered)" : ""}`, payload: { section, prefill_changed: changedFields } },
    tasks,
    resolveTaskTypes: opts.clearedMismatch ? ["review_document_mismatch"] : [],
    actor,
  });
}

/**
 * A document arrived. Resolves the missing-documents task when nothing
 * required is missing any more, and queues a reading of the document when
 * the extractor is switched on and the kind is one that is read.
 */
export async function onDocumentUploaded(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id">,
  document: Pick<DocumentRow, "id" | "requirement_code" | "original_filename" | "scan_status">,
  completeness: Completeness,
  actor: Actor
): Promise<void> {
  const nothingMissing = completeness.missingDocuments.length === 0 && completeness.rejectedDocuments.length === 0;
  const settings = await getSettings(admin);
  const jobs: JobSpec[] =
    settings.aiExtractionEnabled && isExtractable(document.requirement_code) && document.scan_status !== "infected"
      ? [{ type: "document_extract", payload: { document_id: document.id }, idempotencyKey: `extract:${document.id}` }]
      : [];
  await commit(admin, {
    applicationId: app.id,
    expectedStatus: null,
    newStatus: null,
    nextAction: null,
    event: {
      type: "document.uploaded",
      summary: `Document uploaded: ${document.requirement_code.replace(/_/g, " ")}`,
      payload: { document_id: document.id, requirement_code: document.requirement_code, scan_status: document.scan_status },
    },
    resolveTaskTypes: nothingMissing ? ["documents_missing"] : [],
    jobs,
    actor,
  });
}

/**
 * The extractor read a document. Records the reading on the timeline; when
 * it disagrees with the registration, flags the fields on the parent's form
 * and opens a task for a person. Never writes a registration field.
 */
export async function onDocumentExtracted(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "child_first_name">,
  document: Pick<DocumentRow, "id" | "requirement_code">,
  reading: { confidence: number; flags: MismatchFlag[]; existingFlags: Json | null }
): Promise<void> {
  const label = document.requirement_code.replace(/_/g, " ");
  // Replace this document's flags; keep the others'.
  const kept = parseMismatchFlags(reading.existingFlags).filter((f) => f.requirement_code !== document.requirement_code);
  const flags = [...kept, ...reading.flags];
  await admin.from("registrations").update({ mismatch_flags: flags as unknown as Json }).eq("application_id", app.id);

  await commit(admin, {
    applicationId: app.id,
    expectedStatus: null,
    newStatus: null,
    nextAction: null,
    event: {
      type: "document.extracted",
      summary: reading.flags.length
        ? `Document read: ${label} differs from the registration (${reading.flags.map((f) => f.label.toLowerCase()).join(", ")})`
        : `Document read: ${label} agrees with the registration`,
      payload: { document_id: document.id, requirement_code: document.requirement_code, confidence: reading.confidence, mismatches: reading.flags as unknown as Json },
    },
    tasks: reading.flags.length
      ? [
          {
            type: "review_document_mismatch",
            title: `${app.child_first_name}: ${label} differs from the registration`,
            details: `${mismatchText(reading.flags)}\n\nThe reading is a proposal (confidence ${Math.round(reading.confidence * 100)}%). Open the registration to compare, then ask the parent to confirm or correct the form. Nothing has been changed.`,
            priority: "normal",
          },
        ]
      : [],
    resolveTaskTypes: reading.flags.length ? [] : ["review_document_mismatch"],
    actor: SYSTEM_ACTOR,
  });
}

/** Staff ask the parent to check a flagged detail against their document. */
export async function onMismatchConfirmationRequested(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "status">,
  flags: MismatchFlag[],
  actor: Actor
): Promise<void> {
  if (!flags.length) throw new WorkflowError("There is nothing flagged to confirm.", "status_conflict");
  if (app.status !== "registration_incomplete") throw new WorkflowError("The parent can only correct the form while registration is open.", "status_conflict");
  await commit(admin, {
    applicationId: app.id,
    expectedStatus: null,
    newStatus: null,
    nextAction: null,
    event: { type: "document.mismatch_notice_sent", summary: "Parent asked to check a detail against their document", payload: { fields: flags.map((f) => f.field) } },
    jobs: [
      {
        type: "send_email",
        payload: { template_key: "document_mismatch", links: ["registration"], mismatch_details: mismatchText(flags) },
        idempotencyKey: `email:${app.id}:document_mismatch:${Math.floor(Date.now() / 3_600_000)}`,
      },
    ],
    actor,
  });
}

/** Staff accepted or rejected a document. A rejection asks the parent for it again. */
export async function onDocumentReviewed(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "child_first_name">,
  document: Pick<DocumentRow, "id" | "requirement_code" | "review_status">,
  review: { status: "accepted" | "rejected"; note: string | null },
  actor: Actor
): Promise<void> {
  const { data: changed, error } = await admin
    .from("documents")
    .update({ review_status: review.status, review_note: review.note, reviewed_by: actor.type === "staff" ? (actor.id ?? null) : null, reviewed_at: new Date().toISOString() })
    .eq("id", document.id)
    .is("superseded_by", null)
    .select("id");
  if (error) throw new WorkflowError(error.message, "database");
  if (!changed?.length) throw new WorkflowError("That document has been replaced; review the newer one.", "status_conflict");

  const label = document.requirement_code.replace(/_/g, " ");
  await commit(admin, {
    applicationId: app.id,
    expectedStatus: null,
    newStatus: null,
    nextAction: null,
    event: {
      type: "document.reviewed",
      summary: review.status === "accepted" ? `Document accepted: ${label}` : `Document not accepted: ${label}${review.note ? ` — ${review.note}` : ""}`,
      payload: { document_id: document.id, requirement_code: document.requirement_code, status: review.status, note: review.note },
    },
    tasks:
      review.status === "rejected"
        ? [
            {
              type: "documents_missing",
              title: `${app.child_first_name}: ${label} needs to be uploaded again`,
              details: review.note ? `Reason given to the parent: ${review.note}` : "The parent has been asked to upload it again.",
              priority: "normal",
            },
          ]
        : [],
    jobs:
      review.status === "rejected"
        ? [
            {
              type: "send_email",
              payload: { template_key: "documents_missing", links: ["registration"], missing_documents: `${label}${review.note ? ` (${review.note})` : ""}` },
              idempotencyKey: `email:${app.id}:documents_missing:${document.id}`,
            },
          ]
        : [],
    audit: { action: "document.reviewed", entityType: "document", entityId: document.id, after: { status: review.status, note: review.note } },
    actor,
  });
}

/**
 * The parent pressed Submit. Complete → registration_complete and a task
 * for a person to confirm enrolment (or the auto-enrol job when the switch
 * is on). Incomplete → nothing moves; the parent and staff are told what
 * is still needed.
 */
export async function onRegistrationSubmitted(
  admin: AdminClient,
  graph: Pick<ApplicationGraph, "application">,
  completeness: Completeness,
  ctx: { ipHash: string | null },
  actor: Actor
): Promise<{ complete: boolean }> {
  const app = graph.application;
  if (app.status !== "registration_incomplete") throw new WorkflowError("Registration is not open for this application.", "status_conflict");
  const missing = missingDocumentsText(completeness);
  const missingSections = (Object.keys(completeness.sections) as Array<keyof typeof completeness.sections>).filter((s) => !completeness.sections[s]);

  if (!completeness.complete) {
    await commit(admin, {
      applicationId: app.id,
      expectedStatus: null,
      newStatus: null,
      nextAction: null,
      event: {
        type: "registration.submitted_incomplete",
        summary: `Registration submitted with items outstanding: ${missingSections.join(", ")}`,
        payload: { missing_sections: missingSections, missing_documents: missing },
      },
      tasks: missing
        ? [
            {
              type: "documents_missing",
              title: `${app.child_first_name}: documents still needed`,
              details: `Still needed: ${missing}. The parent has been emailed.`,
              priority: "normal",
            },
          ]
        : [],
      jobs: missing
        ? [
            {
              type: "send_email",
              payload: { template_key: "documents_missing", links: ["registration"], missing_documents: missing },
              idempotencyKey: `email:${app.id}:documents_missing:${new Date().toISOString().slice(0, 10)}`,
            },
          ]
        : [],
      actor,
    });
    return { complete: false };
  }

  const settings = await getSettings(admin);
  await admin.from("registrations").update({ submitted_at: new Date().toISOString(), submitted_ip_hash: ctx.ipHash }).eq("application_id", app.id);
  await commit(admin, {
    applicationId: app.id,
    expectedStatus: "registration_incomplete",
    newStatus: "registration_complete",
    nextAction: "none",
    event: { type: "registration.completed", summary: "Registration completed by the parent", payload: {} },
    resolveTaskTypes: ["documents_missing"],
    tasks: settings.autoEnrol
      ? []
      : [
          {
            type: "confirm_enrolment",
            title: `Confirm ${app.child_first_name}'s enrolment`,
            details: "Registration is complete. Check the documents on the registration page, then Confirm enrolment to send the welcome email.",
            priority: "high",
          },
        ],
    jobs: settings.autoEnrol ? [{ type: "auto_enrol", payload: {}, idempotencyKey: `auto_enrol:${app.id}` }] : [],
    audit: { action: "registration.completed", entityType: "registration", entityId: app.id },
    actor,
  });
  return { complete: true };
}
