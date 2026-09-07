import { NextResponse } from "next/server";
import { z } from "zod";
import { adoptUploadedObject, DocumentError } from "@/lib/documents/storage";
import { guardParentUpload } from "@/lib/documents/upload-guard";
import { isExtractable } from "@/lib/documents/extraction-schemas";
import { drainSoon } from "@/lib/parent/actions";
import { registrationCompleteness } from "@/lib/registration/completeness";
import { loadRegistrationBundle } from "@/lib/registration/load";
import { getSettings } from "@/lib/settings";
import { PARENT_ACTOR } from "@/lib/workflow/engine";
import { onDocumentUploaded } from "@/lib/workflow/registration-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  requirement: z.string().min(1).max(60),
  path: z.string().min(1).max(200),
  filename: z.string().max(300),
});

/**
 * Step two: the browser says the object is in the bucket. The server reads
 * it back, judges it like any upload, records the document and runs the
 * same workflow as before (task closes, extraction queued when switched on).
 */
export async function POST(request: Request): Promise<Response> {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, code: "failed" }, { status: 400 });
  // The rate limit was spent when the target was issued.
  const guard = await guardParentUpload(parsed.data.requirement, { rateLimit: false });
  if (!guard.ok) return NextResponse.json({ ok: false, code: guard.code }, { status: guard.status });
  const { admin, graph } = guard.ctx;

  let document;
  try {
    document = await adoptUploadedObject(admin, {
      applicationId: graph.application.id,
      requirementCode: parsed.data.requirement,
      path: parsed.data.path,
      originalFilename: parsed.data.filename || "document",
      uploadedBy: "parent",
    });
  } catch (e) {
    if (e instanceof DocumentError) return NextResponse.json({ ok: false, code: e.code }, { status: 422 });
    console.error("[documents] adopt failed", (e as Error).message);
    return NextResponse.json({ ok: false, code: "failed" }, { status: 500 });
  }
  const after = await loadRegistrationBundle(admin, graph);
  await onDocumentUploaded(admin, graph.application, document, registrationCompleteness({ ...after, gradeSort: graph.grade.sort_order }), PARENT_ACTOR);
  drainSoon();
  const settings = await getSettings(admin);
  const reading = settings.aiExtractionEnabled && isExtractable(document.requirement_code) && document.scan_status !== "infected" && (process.env.DOCUMENT_EXTRACTOR ?? "none") !== "none";
  return NextResponse.json({ ok: true, document: { id: document.id, filename: document.original_filename, uploaded_at: document.uploaded_at, reading } });
}
