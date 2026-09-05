import type { DocumentMime } from "@/lib/supabase/types";

/**
 * What a file is, decided by its first bytes and nothing else. The name a
 * parent's phone gave it and the type their browser claimed are ignored: a
 * text file called scan.pdf is refused.
 */
export function sniffMime(bytes: Uint8Array): DocumentMime | null {
  if (bytes.length < 8) return null;
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return "application/pdf"; // %PDF-
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  return null;
}

export const EXTENSION_FOR: Record<DocumentMime, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

/** A filename fit to store and show back: no paths, no control characters, bounded. */
export function sanitiseFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "document";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return (cleaned || "document").slice(0, 200);
}
