import { requireStaff } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The enrolment snapshot as a file, for the student management system. Read through RLS; the download is audited. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireStaff("data.export");
  const { data: record } = await ctx.supabase.from("student_records").select("*, applications(reference)").eq("application_id", id).maybeSingle();
  if (!record) return new Response("Not found", { status: 404 });
  const reference = (Array.isArray(record.applications) ? record.applications[0] : record.applications)?.reference ?? id;
  await createAdminClient().from("audit_log").insert({
    actor_type: "staff",
    actor_id: ctx.userId,
    actor_label: ctx.profile.email,
    action: "student_record.downloaded",
    entity_type: "student_record",
    entity_id: record.id,
    application_id: id,
  });
  return new Response(JSON.stringify(record.snapshot, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="student-${reference}.json"`,
      "cache-control": "private, no-store",
    },
  });
}
