import { loadApplicationGraph } from "@/lib/applications";
import { renderStaffPdf, STAFF_PDF_KINDS, type StaffPdfKind } from "@/lib/documents/staff-pdf";
import { requireStaff } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Any of the applicant's documents as a PDF, for staff. The application is
 * read under RLS first (so campus scoping and permissions decide), the
 * document is rendered from stored records, and the download is audited.
 * Receipts need finance or offers permission like the Payment tab.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string; kind: string }> }): Promise<Response> {
  const { id, kind } = await ctx.params;
  if (!(STAFF_PDF_KINDS as readonly string[]).includes(kind)) return new Response("Not found", { status: 404 });
  const staff = await requireStaff(kind === "receipt" ? "finance.read" : "applications.read");
  const { data: visible } = await staff.supabase.from("applications").select("id").eq("id", id).maybeSingle();
  if (!visible) return new Response("Not found", { status: 404 });

  const admin = createAdminClient();
  const graph = await loadApplicationGraph(admin, id);
  if (!graph) return new Response("Not found", { status: 404 });
  const result = await renderStaffPdf(admin, graph, kind as StaffPdfKind);
  if ("unavailable" in result) return new Response(result.unavailable, { status: 409, headers: { "content-type": "text/plain; charset=utf-8" } });

  await admin.from("audit_log").insert({
    actor_type: "staff",
    actor_id: staff.userId,
    actor_label: staff.profile.email,
    action: "document.downloaded",
    entity_type: "application",
    entity_id: id,
    application_id: id,
    after: { kind, filename: result.filename },
  });
  const download = new URL(request.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(result.buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${result.filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
