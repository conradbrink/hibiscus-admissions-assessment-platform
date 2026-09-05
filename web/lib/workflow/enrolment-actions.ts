import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { ApplicationGraph } from "@/lib/applications";
import { getStudentSystem } from "@/lib/enrolment/integration";
import { buildStudentRecord } from "@/lib/enrolment/student-record";
import { loadRegistrationBundle } from "@/lib/registration/load";
import type { Json } from "@/lib/supabase/types";
import { commit, WorkflowError, type Actor } from "@/lib/workflow/engine";

/**
 * The last move. Refused unless registration is complete and no required
 * document was rejected; generates the student record; tries the student
 * system; emits `enrolment.completed` (the milestone); sends the welcome.
 */
export async function onEnrolmentConfirmed(admin: AdminClient, graph: ApplicationGraph, actor: Actor): Promise<void> {
  const app = graph.application;
  if (app.status !== "registration_complete") throw new WorkflowError(`Application is ${app.status}; only a completed registration can be enrolled.`, "status_conflict");
  const bundle = await loadRegistrationBundle(admin, graph);
  if (!bundle.completeness.complete) {
    const missing = [...bundle.completeness.missingDocuments, ...bundle.completeness.rejectedDocuments].map((d) => d.label);
    throw new WorkflowError(missing.length ? `Cannot enrol yet: still needed — ${missing.join(", ")}.` : "Cannot enrol yet: registration is not complete.", "status_conflict");
  }
  const pendingReview = bundle.documents.filter((d) => !d.superseded_by && !d.deleted_at && d.review_status === "pending" && bundle.requirements.some((q) => q.code === d.requirement_code && q.required));
  if (pendingReview.length && actor.type === "staff") {
    // A person confirming is expected to have looked; the auto path enrols on receipt.
    throw new WorkflowError(`Accept or reject the documents first: ${pendingReview.map((d) => d.requirement_code.replace(/_/g, " ")).join(", ")}.`, "status_conflict");
  }

  const [{ data: request }, { data: payments }] = await Promise.all([
    admin.from("payment_requests").select("*").eq("application_id", app.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("payments").select("*").eq("application_id", app.id),
  ]);
  const snapshot = buildStudentRecord(graph, bundle, { request: request ?? null, payments: payments ?? [] });
  const { data: record, error } = await admin
    .from("student_records")
    .upsert({ application_id: app.id, schema_version: 1, snapshot: snapshot as unknown as Json, generated_by: actor.type === "staff" ? (actor.id ?? null) : null, generated_at: new Date().toISOString() }, { onConflict: "application_id" })
    .select("id")
    .single();
  if (error || !record) throw new WorkflowError(error?.message ?? "student record failed", "database");

  const system = getStudentSystem();
  const exported = await system.exportStudent(snapshot);
  await admin
    .from("student_records")
    .update(exported.ok ? { export_status: "exported", exported_at: new Date().toISOString(), external_ref: exported.externalRef, export_error: null } : { export_status: "pending", export_error: exported.error })
    .eq("id", record.id);

  await commit(admin, {
    applicationId: app.id,
    expectedStatus: "registration_complete",
    newStatus: "enrolled",
    nextAction: "none",
    event: { type: "enrolment.completed", summary: "Enrolment confirmed", payload: { student_record_id: record.id, student_system: system.name, exported: exported.ok } },
    resolveTaskTypes: ["confirm_enrolment", "review_registration_change"],
    tasks: [
      {
        type: "notify_campus_enrolled",
        title: `${app.child_first_name} ${app.child_last_name} is enrolled — ${graph.campus.name}, ${graph.grade.name}`,
        details: exported.ok ? `Welcome email sent. Student record exported (${exported.externalRef}).` : "Welcome email sent. The student record is ready to download from the registration page for the student system.",
        priority: "low",
      },
    ],
    jobs: [{ type: "send_email", payload: { template_key: "welcome_enrolled" }, idempotencyKey: `email:${app.id}:welcome_enrolled` }],
    audit: { action: "enrolment.confirmed", entityType: "student_record", entityId: record.id, after: { student_system: system.name, exported: exported.ok } },
    actor,
  });
}
