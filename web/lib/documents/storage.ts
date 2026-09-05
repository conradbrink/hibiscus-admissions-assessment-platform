import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { getDocumentScanner } from "@/lib/documents/scanner";
import { sanitiseFilename, sniffMime } from "@/lib/documents/sniff";
import type { AdminClient } from "@/lib/supabase/admin";
import type { DocumentRow } from "@/lib/supabase/types";

/**
 * Documents live in one private bucket that only the service role touches.
 * There are no storage policies to get wrong: a parent uploads through a
 * route that verified their session, staff view through a route that read
 * the document row under RLS and minted a URL good for a minute.
 */

export const BUCKET = "applicant-documents";
export const MAX_BYTES = 10 * 1024 * 1024;

export class DocumentError extends Error {
  constructor(public readonly code: "too_large" | "bad_type" | "empty" | "failed") {
    super(code);
  }
}

let ensured = false;

/** The bucket is created by the application at first use rather than by a migration the local replay cannot run. */
export async function ensureBucket(admin: AdminClient): Promise<void> {
  if (ensured) return;
  const { error } = await admin.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: MAX_BYTES,
    allowedMimeTypes: ["application/pdf", "image/jpeg", "image/png"],
  });
  if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(`storage bucket: ${error.message}`);
  ensured = true;
}

export async function storeDocument(
  admin: AdminClient,
  opts: { applicationId: string; requirementCode: string; bytes: Uint8Array; originalFilename: string; uploadedBy: "parent" | "staff"; staffId?: string | null }
): Promise<DocumentRow> {
  if (opts.bytes.length === 0) throw new DocumentError("empty");
  if (opts.bytes.length > MAX_BYTES) throw new DocumentError("too_large");
  const mime = sniffMime(opts.bytes);
  if (!mime) throw new DocumentError("bad_type");

  await ensureBucket(admin);
  const sha256 = createHash("sha256").update(opts.bytes).digest("hex");
  const path = `applications/${opts.applicationId}/${randomUUID()}`;
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, opts.bytes, { contentType: mime, upsert: false });
  if (upErr) throw new Error(`storage upload: ${upErr.message}`);

  const scan = await getDocumentScanner().scan(opts.bytes, mime);

  const { data: previous } = await admin
    .from("documents")
    .select("id")
    .eq("application_id", opts.applicationId)
    .eq("requirement_code", opts.requirementCode)
    .is("superseded_by", null)
    .is("deleted_at", null)
    .maybeSingle();

  const { data, error } = await admin
    .from("documents")
    .insert({
      application_id: opts.applicationId,
      requirement_code: opts.requirementCode,
      storage_bucket: BUCKET,
      storage_path: path,
      original_filename: sanitiseFilename(opts.originalFilename),
      mime_type: mime,
      size_bytes: opts.bytes.length,
      sha256,
      uploaded_by: opts.uploadedBy,
      uploaded_by_staff_id: opts.staffId ?? null,
      scan_status: scan.status,
      scanner: getDocumentScanner().name,
    })
    .select("*")
    .single();
  if (error || !data) {
    await admin.storage.from(BUCKET).remove([path]);
    throw new Error(error?.message ?? "document insert failed");
  }
  if (previous) {
    // The old upload stays on disk and in history; it just stops being "the" document.
    await admin.from("documents").update({ superseded_by: data.id }).eq("id", previous.id);
  }
  return data;
}

/** A URL good for one minute. Minted only after the caller has read the row under RLS. */
export async function signedUrlFor(admin: AdminClient, document: Pick<DocumentRow, "storage_bucket" | "storage_path">, seconds = 60): Promise<string> {
  const { data, error } = await admin.storage.from(document.storage_bucket).createSignedUrl(document.storage_path, seconds);
  if (error || !data) throw new Error(`signed url: ${error?.message ?? "failed"}`);
  return data.signedUrl;
}

/** The bytes of a stored document, for the extractor. Service role only; the caller has already read the row. */
export async function downloadDocument(admin: AdminClient, document: Pick<DocumentRow, "storage_bucket" | "storage_path">): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from(document.storage_bucket).download(document.storage_path);
  if (error || !data) throw new Error(`storage download: ${error?.message ?? "failed"}`);
  return new Uint8Array(await data.arrayBuffer());
}
