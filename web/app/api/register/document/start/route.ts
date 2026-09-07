import { NextResponse } from "next/server";
import { z } from "zod";
import { createUploadTarget, MAX_BYTES } from "@/lib/documents/storage";
import { guardParentUpload } from "@/lib/documents/upload-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  requirement: z.string().min(1).max(60),
  size: z.number().int().positive(),
  type: z.string().max(100).optional(),
});

/**
 * Step one of a browser upload: the page asks where to put the file. The
 * answer is a signed URL straight into the private bucket, so the bytes
 * never pass through this server (and never meet its request-size limit).
 * The same checks as the multipart route apply before a URL is handed out.
 */
export async function POST(request: Request): Promise<Response> {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, code: "failed" }, { status: 400 });
  if (parsed.data.size > MAX_BYTES) return NextResponse.json({ ok: false, code: "too_large" }, { status: 413 });
  const guard = await guardParentUpload(parsed.data.requirement);
  if (!guard.ok) return NextResponse.json({ ok: false, code: guard.code }, { status: guard.status });
  try {
    const target = await createUploadTarget(guard.ctx.admin, guard.ctx.graph.application.id);
    return NextResponse.json({ ok: true, ...target });
  } catch (e) {
    console.error("[documents] upload target failed", (e as Error).message);
    return NextResponse.json({ ok: false, code: "failed" }, { status: 500 });
  }
}
