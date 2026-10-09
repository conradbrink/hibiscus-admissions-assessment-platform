import "server-only";
import type { ScanStatus } from "@/lib/supabase/types";

/**
 * The seam for malware scanning. Phase 3 ships no scanner: every document
 * is stored as `not_scanned` and staff see that label. A scanner is a
 * second implementation here and an env var; nothing else changes.
 */
export interface DocumentScanner {
  readonly name: string;
  scan(bytes: Uint8Array, mime: string): Promise<{ status: ScanStatus; detail?: string }>;
}

export const noneScanner: DocumentScanner = {
  name: "none",
  async scan() {
    return { status: "not_scanned" };
  },
};

export function getDocumentScanner(): DocumentScanner {
  const which = process.env.DOCUMENT_SCANNER ?? "none";
  if (which === "none") return noneScanner;
  throw new Error(`DOCUMENT_SCANNER "${which}" is not implemented.`);
}
