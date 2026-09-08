import { readFile } from "node:fs/promises";
import path from "node:path";
import { readKioskSession } from "@/lib/assessment/kiosk-server";
import { getStaff } from "@/lib/staff/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A picture that belongs to a question: the diagram, table or chart the
 * paper printed beside it. The files ship with the app under
 * web/content (a question's `stem_media_path` names one, e.g.
 * papers/media/s4-mathematics-q3.png) and are served only to a computer
 * with an open sitting or a signed-in staff member. The papers are the
 * school's licensed copies and never sit on a public URL.
 */

const SEGMENT = /^[a-z0-9][a-z0-9._-]*$/i;
const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml" };

export async function GET(_request: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path: parts } = await ctx.params;
  if (!Array.isArray(parts) || parts.length === 0 || parts.length > 4 || !parts.every((p) => SEGMENT.test(p) && p !== "." && p !== "..")) {
    return new Response("Not found", { status: 404 });
  }
  const type = TYPES[path.extname(parts[parts.length - 1]).toLowerCase()];
  if (!type) return new Response("Not found", { status: 404 });

  const [session, staff] = await Promise.all([readKioskSession(), getStaff()]);
  if (!session && !staff) return new Response("Unauthorized", { status: 401 });

  try {
    const bytes = await readFile(path.join(process.cwd(), "content", ...parts));
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { "content-type": type, "cache-control": "private, max-age=86400" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
