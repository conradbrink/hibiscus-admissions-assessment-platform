import { NextResponse } from "next/server";
import { z } from "zod";
import { guardApplicantUpload } from "@/lib/applicant/upload-guard";
import { createUploadTarget, MAX_BYTES } from "@/lib/documents/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ size: z.number().int().positive() });

/** Step one of an upload: a signed URL into the private bucket, so the bytes never pass through this server. */
export async function POST(request: Request): Promise<Response> {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, code: "failed" }, { status: 400 });
  if (parsed.data.size > MAX_BYTES) return NextResponse.json({ ok: false, code: "too_large" }, { status: 413 });
  const guard = await guardApplicantUpload();
  if (!guard.ok) return NextResponse.json({ ok: false, code: guard.code }, { status: guard.status });
  try {
    const target = await createUploadTarget(guard.admin, guard.applicationId);
    return NextResponse.json({ ok: true, ...target });
  } catch (e) {
    console.error("[hr documents] upload target failed", (e as Error).message);
    return NextResponse.json({ ok: false, code: "failed" }, { status: 500 });
  }
}
