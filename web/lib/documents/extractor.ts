import "server-only";
import type { z } from "zod";
import { getAiProvider } from "@/lib/ai/provider";
import { devOutputFor, isExtractable, schemaFor, systemPromptFor, userPromptFor, EXTRACTION_PROMPT_VERSION } from "@/lib/documents/extraction-schemas";
import type { DocumentRow, Json } from "@/lib/supabase/types";

/**
 * Reading a birth certificate or report and proposing values.
 *
 * The rule, fixed in Phase 3 so nobody designs against it: an extractor
 * writes `documents.extracted_fields` and `extraction_status` and nothing
 * else. It never changes the registration. Where a proposed value
 * disagrees with what the parent typed, the pipeline opens a staff task
 * and flags the field on the parent's form; the parent's save is the write.
 *
 * What the model sees: the file and which kind of document it is. No name,
 * no date of birth, nothing else the family told us — so it cannot be led.
 */

export type ExtractionResult =
  | { ok: true; fields: Record<string, Json>; confidence: number; model: string }
  | { ok: false; error: string; retryable: boolean };

export interface DocumentExtractor {
  readonly name: string;
  extract(document: Pick<DocumentRow, "id" | "requirement_code" | "mime_type">, bytes: Uint8Array): Promise<ExtractionResult>;
}

export const noneExtractor: DocumentExtractor = {
  name: "none",
  async extract() {
    return { ok: false, error: "No document extractor is configured.", retryable: false };
  },
};

/** Claude, through the one AI seam, with the file attached and a schema per document kind. */
export const anthropicExtractor: DocumentExtractor = {
  name: "anthropic",
  async extract(document, bytes) {
    const code = document.requirement_code;
    if (!isExtractable(code)) return { ok: false, error: `"${code}" is not a document kind that is read.`, retryable: false };
    const provider = await getAiProvider();
    // One schema per document kind; the union collapses to a record for the caller.
    const schema = schemaFor(code) as unknown as z.ZodType<Record<string, Json> & { confidence: number }>;
    const result = await provider.generateStructured({
      schema,
      system: systemPromptFor(code),
      input: userPromptFor(code),
      attachments: [{ mime: document.mime_type, bytes, title: code.replace(/_/g, " ") }],
      maxTokens: 1500,
      devOutput: () => devOutputFor(code) as never,
    });
    if (!result.ok) return { ok: false, error: `${result.reason}: ${result.error ?? ""}`.trim(), retryable: result.retryable };
    const { confidence, ...fields } = result.output;
    return { ok: true, fields, confidence, model: `${result.model} (${EXTRACTION_PROMPT_VERSION})` };
  },
};

export function getDocumentExtractor(): DocumentExtractor {
  const which = process.env.DOCUMENT_EXTRACTOR ?? "none";
  if (which === "none") return noneExtractor;
  if (which === "anthropic") return anthropicExtractor;
  throw new Error(`DOCUMENT_EXTRACTOR "${which}" is not implemented.`);
}
