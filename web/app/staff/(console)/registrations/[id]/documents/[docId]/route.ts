import { redirect } from "next/navigation";
import { signedUrlFor } from "@/lib/documents/storage";
import { requireStaff } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The only way to a document's bytes: read the row through the caller's own
 * client (permission and campus decided by the policies), record the view,
 * then a URL good for one minute.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  const ctx = await requireStaff("applications.read");
  const { data: document } = await ctx.supabase.from("documents").select("*").eq("id", docId).eq("application_id", id).maybeSingle();
  if (!document) return new Response("Not found", { status: 404 });
  const admin = createAdminClient();
  await admin.from("audit_log").insert({
    actor_type: "staff",
    actor_id: ctx.userId,
    actor_label: ctx.profile.email,
    action: "document.viewed",
    entity_type: "document",
    entity_id: document.id,
    application_id: document.application_id,
    after: { requirement_code: document.requirement_code },
  });
  const url = await signedUrlFor(admin, document, 60);
  redirect(url);
}
