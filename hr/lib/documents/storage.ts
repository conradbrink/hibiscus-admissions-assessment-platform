import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { getDocumentScanner } from "@/lib/documents/scanner";
import { sanitiseFilename, sniffMime } from "@/lib/documents/sniff";
import type { AdminClient } from "@/lib/supabase/admin";
import type { ApplicationDocumentKind, HrApplicationDocumentRow } from "@/lib/supabase/types";

/**
 * The one door documents go through: `adoptUploadedObject` stores (sniffed,
 * capped, hashed, at a path with no user-controlled segment) and
 * `signedUrlFor` reads, for a minute, after a staff route has selected the
 * row under RLS. The bucket is private, has no policies, and only the
 * service role touches it. Never hand a storage path to an applicant page.
 *
 * The same shape as admissions' `lib/documents/storage.ts`, on HR's own
 * bucket, so an admissions bug cannot serve a teacher's police clearance.
 */

export const BUCKET = "hr-documents";
export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENTS = 12;

export class DocumentError extends Error {
  constructor(public readonly code: "too_large" | "bad_type" | "empty" | "failed" | "too_many") {
    super(code);
  }
}

let ensured = false;

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

function objectPath(applicationId: string): string {
  return `applications/${applicationId}/${randomUUID()}`;
}

export function isApplicationPath(applicationId: string, path: string): boolean {
  return new RegExp(`^applications/${applicationId}/[0-9a-f-]{36}$`).test(path);
}

/** Step one of a browser upload: a signed URL straight into the private bucket. */
export async function createUploadTarget(admin: AdminClient, applicationId: string): Promise<{ path: string; signedUrl: string }> {
  await ensureBucket(admin);
  const path = objectPath(applicationId);
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`signed upload url: ${error?.message ?? "failed"}`);
  return { path, signedUrl: data.signedUrl };
}

/** Step two: read the bytes back, check them, and record them. A file that fails is deleted. */
export async function adoptUploadedObject(
  admin: AdminClient,
  opts: { applicationId: string; kind: ApplicationDocumentKind; path: string; originalFilename: string }
): Promise<HrApplicationDocumentRow> {
  if (!isApplicationPath(opts.applicationId, opts.path)) throw new DocumentError("failed");
  const { data, error } = await admin.storage.from(BUCKET).download(opts.path);
  if (error || !data) throw new DocumentError("empty");
  const bytes = new Uint8Array(await data.arrayBuffer());
  const reject = async (code: DocumentError["code"]) => {
    await admin.storage.from(BUCKET).remove([opts.path]);
    return new DocumentError(code);
  };
  if (bytes.length === 0) throw await reject("empty");
  if (bytes.length > MAX_BYTES) throw await reject("too_large");
  const mime = sniffMime(bytes);
  if (!mime) throw await reject("bad_type");
  const { count } = await admin.from("hr_application_documents").select("id", { count: "exact", head: true }).eq("application_id", opts.applicationId);
  if ((count ?? 0) >= MAX_DOCUMENTS) throw await reject("too_many");

  const scan = await getDocumentScanner().scan(bytes, mime);
  const { data: row, error: insertError } = await admin
    .from("hr_application_documents")
    .insert({
      application_id: opts.applicationId,
      kind: opts.kind,
      file_name: sanitiseFilename(opts.originalFilename),
      storage_path: opts.path,
      mime,
      size_bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      scan_status: scan.status,
    })
    .select("*")
    .single();
  if (insertError || !row) {
    await admin.storage.from(BUCKET).remove([opts.path]);
    throw new Error(insertError?.message ?? "document insert failed");
  }
  return row;
}

export async function removeDocument(admin: AdminClient, applicationId: string, documentId: string): Promise<void> {
  const { data } = await admin.from("hr_application_documents").select("storage_path").eq("id", documentId).eq("application_id", applicationId).maybeSingle();
  if (!data) return;
  await admin.storage.from(BUCKET).remove([data.storage_path]);
  await admin.from("hr_application_documents").delete().eq("id", documentId);
}

export async function signedUrlFor(admin: AdminClient, path: string, seconds = 60): Promise<string> {
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, seconds);
  if (error || !data) throw new Error(`signed url: ${error?.message ?? "failed"}`);
  return data.signedUrl;
}

/** Every stored object for an application, removed before the row is anonymised. */
export async function removeApplicationObjects(admin: AdminClient, applicationId: string): Promise<number> {
  const { data } = await admin.from("hr_application_documents").select("storage_path").eq("application_id", applicationId);
  const paths = (data ?? []).map((d) => d.storage_path);
  if (!paths.length) return 0;
  const { error } = await admin.storage.from(BUCKET).remove(paths);
  if (error) throw new Error(`storage remove: ${error.message}`);
  return paths.length;
}
