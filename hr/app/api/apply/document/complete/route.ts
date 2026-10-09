import { NextResponse } from "next/server";
import { z } from "zod";
import { guardApplicantUpload } from "@/lib/applicant/upload-guard";
import { adoptUploadedObject, DocumentError } from "@/lib/documents/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  kind: z.enum(["cv", "certificate", "registration", "permit", "police_clearance", "id", "other"]),
  path: z.string().max(200),
  filename: z.string().max(300),
});

/** Step two: read the uploaded bytes back, check what they are, and record them. */
export async function POST(request: Request): Promise<Response> {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, code: "failed" }, { status: 400 });
  const guard = await guardApplicantUpload();
  if (!guard.ok) return NextResponse.json({ ok: false, code: guard.code }, { status: guard.status });
  try {
    const row = await adoptUploadedObject(guard.admin, {
      applicationId: guard.applicationId,
      kind: parsed.data.kind,
      path: parsed.data.path,
      originalFilename: parsed.data.filename,
    });
    return NextResponse.json({ ok: true, document: { id: row.id, kind: row.kind, file_name: row.file_name, size_bytes: row.size_bytes } });
  } catch (e) {
    if (e instanceof DocumentError) return NextResponse.json({ ok: false, code: e.code }, { status: 422 });
    console.error("[hr documents] adopt failed", (e as Error).message);
    return NextResponse.json({ ok: false, code: "failed" }, { status: 500 });
  }
}
