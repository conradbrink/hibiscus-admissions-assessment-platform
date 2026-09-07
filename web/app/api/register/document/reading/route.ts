import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readParentSession } from "@/lib/tokens/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Has the document been read yet? The student step polls this after an
 * upload so the form can fill itself in once the reading lands. Only the
 * status is returned; the values arrive with the page, never through here.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await readParentSession();
  if (!session) return NextResponse.json({ status: "expired" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ status: "unknown" }, { status: 400 });
  const { data } = await createAdminClient().from("documents").select("extraction_status").eq("id", id).eq("application_id", session.applicationId).maybeSingle();
  return NextResponse.json({ status: data?.extraction_status ?? "unknown" });
}
