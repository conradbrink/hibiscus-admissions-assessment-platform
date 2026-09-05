import { exportFilename, renderRows, toCsv, toJson, type ExportColumn } from "@/lib/enrolment/export";
import { requireStaff } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST: render the selected records as a file, record the batch, and mark
 * the records exported. GET ?batch=: re-render an earlier batch with the
 * columns it was made with. Both read through RLS first; the writes that
 * follow use the service role for rows the caller was allowed to see.
 */
export async function POST(request: Request) {
  const ctx = await requireStaff("data.export");
  const form = await request.formData();
  const format = form.get("format") === "json" ? "json" : "csv";
  const campus = String(form.get("campus") ?? "") || null;
  const intake = String(form.get("intake") ?? "") || null;
  const includeExported = form.get("all") === "1";

  let q = ctx.supabase
    .from("student_records")
    .select("id, application_id, snapshot, applications!inner(campus_id, intake_id, campuses(code))")
    .order("generated_at", { ascending: false })
    .limit(500);
  if (campus) q = q.eq("applications.campus_id", campus);
  if (intake) q = q.eq("applications.intake_id", intake);
  if (!includeExported) q = q.eq("export_status", "pending");
  const [{ data: records }, { data: columnRows }] = await Promise.all([q, ctx.supabase.from("export_columns").select("header, source_path, transform").eq("is_active", true).order("position")]);
  if (!records?.length) return new Response("Nothing to export", { status: 404 });
  const columns: ExportColumn[] = (columnRows ?? []).map((c) => ({ header: c.header, source_path: c.source_path, transform: c.transform }));
  if (!columns.length) return new Response("No export columns are active", { status: 400 });

  const now = new Date();
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const campusCode = campus ? (one(one(records[0].applications)?.campuses)?.code ?? null) : null;
  const filename = exportFilename(format, now, campusCode);
  const body = render(format, columns, records.map((r) => r.snapshot));

  const admin = createAdminClient();
  const { data: batch, error } = await admin
    .from("student_exports")
    .insert({ campus_id: campus, intake_id: intake, format, record_count: records.length, filename, columns_snapshot: columns as unknown as Json, created_by: ctx.userId })
    .select("id")
    .single();
  if (error || !batch) return new Response(error?.message ?? "Could not record the batch", { status: 500 });
  const ids = records.map((r) => r.id);
  await admin.rpc("mark_student_records_exported", { p_record_ids: ids, p_batch_id: batch.id });
  await admin.from("audit_log").insert({
    actor_type: "staff",
    actor_id: ctx.userId,
    actor_label: ctx.profile.email,
    action: "student_records.exported",
    entity_type: "student_export",
    entity_id: batch.id,
    after: { record_count: records.length, format, campus_id: campus, intake_id: intake },
  });
  return file(body, filename, format);
}

export async function GET(request: Request) {
  const ctx = await requireStaff("data.export");
  const batchId = new URL(request.url).searchParams.get("batch");
  if (!batchId) return new Response("Missing batch", { status: 400 });
  const { data: batch } = await ctx.supabase.from("student_exports").select("*").eq("id", batchId).maybeSingle();
  if (!batch) return new Response("Not found", { status: 404 });
  const { data: records } = await ctx.supabase.from("student_records").select("snapshot").eq("export_batch_id", batch.id);
  const columns = (Array.isArray(batch.columns_snapshot) ? batch.columns_snapshot : []) as unknown as ExportColumn[];
  const body = render(batch.format, columns, (records ?? []).map((r) => r.snapshot));
  await createAdminClient().from("audit_log").insert({
    actor_type: "staff",
    actor_id: ctx.userId,
    actor_label: ctx.profile.email,
    action: "student_export.downloaded_again",
    entity_type: "student_export",
    entity_id: batch.id,
  });
  return file(body, batch.filename, batch.format);
}

function render(format: "csv" | "json", columns: ExportColumn[], snapshots: unknown[]): string {
  const headers = columns.map((c) => c.header);
  const rows = renderRows(snapshots, columns);
  return format === "json" ? toJson(headers, rows) : toCsv(headers, rows);
}

function file(body: string, filename: string, format: "csv" | "json"): Response {
  return new Response(body, {
    headers: {
      "content-type": format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
