import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { compareExtraction, mismatchFlags } from "@/lib/documents/compare";
import { getDocumentExtractor } from "@/lib/documents/extractor";
import { downloadDocument } from "@/lib/documents/storage";
import type { JobRow } from "@/lib/supabase/types";
import type { HandlerResult } from "@/lib/workflow/handlers";
import { onDocumentExtracted } from "@/lib/workflow/registration-actions";

/**
 * Reads one uploaded document with the configured extractor, records what
 * it found on the document row, compares it with the registration, and
 * hands the disagreements to the engine. Nothing here touches the
 * registration's own fields.
 */
export async function documentExtractHandler(admin: AdminClient, job: JobRow): Promise<HandlerResult> {
  const p = job.payload as { document_id?: string };
  if (!p.document_id || !job.application_id) return { outcome: "failed", error: "document_extract job missing document_id or application", retryable: false };

  const { data: document } = await admin.from("documents").select("*").eq("id", p.document_id).maybeSingle();
  if (!document) return { outcome: "skipped", reason: "document missing" };
  if (document.superseded_by || document.deleted_at) return { outcome: "skipped", reason: "document replaced" };
  if (document.scan_status === "infected") return { outcome: "skipped", reason: "document infected" };

  const extractor = getDocumentExtractor();
  if (extractor.name === "none") return { outcome: "skipped", reason: "no extractor configured" };

  await admin.from("documents").update({ extraction_status: "pending" }).eq("id", document.id);
  let bytes: Uint8Array;
  try {
    bytes = await downloadDocument(admin, document);
  } catch (e) {
    await admin.from("documents").update({ extraction_status: "failed", extraction_error: (e as Error).message }).eq("id", document.id);
    return { outcome: "failed", error: (e as Error).message, retryable: true };
  }

  const result = await extractor.extract(document, bytes);
  if (!result.ok) {
    await admin.from("documents").update({ extraction_status: "failed", extraction_error: result.error, extraction_model: extractor.name }).eq("id", document.id);
    return result.retryable ? { outcome: "failed", error: result.error, retryable: true } : { outcome: "skipped", reason: result.error };
  }

  const [{ data: registration }, { data: app }] = await Promise.all([
    admin.from("registrations").select("*").eq("application_id", job.application_id).maybeSingle(),
    admin.from("applications").select("id, child_first_name, child_last_name, child_date_of_birth").eq("id", job.application_id).single(),
  ]);
  if (!app) return { outcome: "skipped", reason: "application missing" };

  const comparisons = compareExtraction(
    {
      legal_first_name: registration?.legal_first_name ?? app.child_first_name,
      legal_middle_names: registration?.legal_middle_names ?? null,
      legal_last_name: registration?.legal_last_name ?? app.child_last_name,
      date_of_birth: registration?.date_of_birth ?? app.child_date_of_birth,
      place_of_birth: registration?.place_of_birth ?? null,
      gender: registration?.gender ?? null,
      previous_institution: registration?.previous_institution ?? null,
      current_grade: registration?.current_grade ?? null,
    },
    result.fields,
    document.requirement_code
  );

  await admin
    .from("documents")
    .update({
      extraction_status: "done",
      extracted_fields: { ...result.fields, confidence: result.confidence, comparisons },
      extraction_model: result.model,
      extraction_error: null,
      extracted_at: new Date().toISOString(),
    })
    .eq("id", document.id);

  await onDocumentExtracted(admin, app, document, {
    confidence: result.confidence,
    flags: mismatchFlags(comparisons, document.requirement_code, document.id),
    existingFlags: registration?.mismatch_flags ?? null,
  });
  return { outcome: "done" };
}
