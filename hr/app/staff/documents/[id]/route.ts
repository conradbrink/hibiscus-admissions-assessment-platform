import { NextResponse } from "next/server";
import { audit, staffActor } from "@/lib/audit";
import { signedUrlFor } from "@/lib/documents/storage";
import { getStaff } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The one way staff open an applicant's document: the row is selected under
 * RLS first (so the campus and compliance rules decide), then a one-minute
 * signed URL is minted and the browser is sent to it. Every opening is
 * audited, because these are police clearances and identity documents.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getStaff();
  if (!ctx) return NextResponse.redirect(new URL("/staff/login", request.url));
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const { data: doc } = await ctx.supabase.from("hr_application_documents").select("id, storage_path, application_id, kind").eq("id", id).maybeSingle();
  if (!doc) return new NextResponse("Not found", { status: 404 });
  const admin = createAdminClient();
  await audit(admin, staffActor(ctx), {
    action: "document_opened",
    entityType: "hr_application_document",
    entityId: doc.id,
    applicationId: doc.application_id,
    sensitivity: ["police_clearance", "id", "permit"].includes(doc.kind) ? "compliance" : "normal",
  });
  return NextResponse.redirect(await signedUrlFor(admin, doc.storage_path, 60));
}
