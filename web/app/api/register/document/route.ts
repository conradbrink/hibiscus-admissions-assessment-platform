import { redirect } from "next/navigation";
import { DocumentError, storeDocument } from "@/lib/documents/storage";
import { drainSoon } from "@/lib/parent/actions";
import { loadApplicationGraph } from "@/lib/applications";
import { applicableRequirements, liveDocument, registrationCompleteness } from "@/lib/registration/completeness";
import { loadRegistrationBundle } from "@/lib/registration/load";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { readParentSession } from "@/lib/tokens/server";
import { PARENT_ACTOR } from "@/lib/workflow/engine";
import { onDocumentUploaded } from "@/lib/workflow/registration-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A plain multipart POST from the documents page. The session names the
 * application; the requirement must apply to the child's grade; the bytes
 * decide the type. Errors go back to the page as a code, never a message
 * with anything a parent typed in it.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await readParentSession();
  if (!session) redirect("/link?expired=1");
  const admin = createAdminClient();
  const form = await request.formData();
  const requirement = String(form.get("requirement") ?? "");
  const back = (code: string) => redirect(`/register/documents?error=${code}&req=${encodeURIComponent(requirement)}`);

  const graph = await loadApplicationGraph(admin, session.applicationId);
  if (!graph) redirect("/link?reason=unknown");
  const bundle = await loadRegistrationBundle(admin, graph);
  const applicable = applicableRequirements(bundle.requirements, graph.grade.sort_order).find((q) => q.code === requirement);
  if (!applicable) return back("unknown_requirement");
  const status = graph.application.status;
  const existing = liveDocument(bundle.documents, requirement);
  const rejected = existing?.review_status === "rejected" || existing?.scan_status === "infected";
  if (status !== "registration_incomplete" && !((status === "registration_complete" || status === "enrolled") && rejected)) return back("not_open");

  const verdict = await enforceRateLimit(admin, LIMITS.documentUpload, graph.application.id);
  if (!verdict.ok) return back("busy");

  const file = form.get("file");
  if (!(file instanceof File)) return back("empty");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let document;
  try {
    document = await storeDocument(admin, { applicationId: graph.application.id, requirementCode: requirement, bytes, originalFilename: file.name, uploadedBy: "parent" });
  } catch (e) {
    if (e instanceof DocumentError) return back(e.code);
    console.error("[documents] upload failed", e);
    return back("failed");
  }
  const after = await loadRegistrationBundle(admin, graph);
  await onDocumentUploaded(admin, graph.application, document, registrationCompleteness({ ...after, gradeSort: graph.grade.sort_order }), PARENT_ACTOR);
  drainSoon();
  redirect("/register/documents");
}
