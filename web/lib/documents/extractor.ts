import type { DocumentRow, Json } from "@/lib/supabase/types";

/**
 * Phase 4 seam: reading a birth certificate or report and proposing values.
 *
 * The rule, fixed now so nobody designs against it: an extractor writes
 * `documents.extracted_fields` and `extraction_status` and nothing else. It
 * never changes the registration. Where a proposed value disagrees with
 * what the parent typed, the pipeline opens a staff task ("the date of
 * birth on the document differs") and the parent is asked to confirm; the
 * confirmation is the write.
 */
export interface DocumentExtractor {
  readonly name: string;
  extract(document: Pick<DocumentRow, "id" | "requirement_code" | "mime_type">, bytes: Uint8Array): Promise<{ fields: Record<string, Json>; confidence: number }>;
}
