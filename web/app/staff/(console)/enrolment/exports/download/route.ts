import { PARENT_COLUMNS, parentRow, STUDENT_COLUMNS, studentRow } from "@/lib/enrolment/ed-admin";
import { exportFilename, renderRows, toCsv, toJson, type ExportColumn } from "@/lib/enrolment/export";
import type { StudentRecordSnapshot } from "@/lib/enrolment/student-record";
import { requireStaff } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Three layouts, two of which are the school's other system's own templates.
 *
 * Those two are deliberately separate files: parent details and student
 * details are never pulled together, and the family code is the only value in
 * both — it is what puts siblings on one account so the school sends one
 * statement.
 *
 * The **student** file records the transfer: it creates the batch and marks
 * the records exported. The **parent** file is its companion and changes
 * nothing, so it can be taken before or after, for the current selection or
 * for a past batch, and the pair always matches.
 *
 * `custom` is the configurable column mapping from Settings, kept for anyone
 * who needs a different shape.
 *
 * Every read goes through the caller's own client first, so campus scoping
 * applies; the writes that follow use the service role for rows they were
 * already allowed to see.
 */
type Layout = "parent" | "student" | "custom";

const LAYOUT_MARKER = "ed-admin:";

function layoutOf(value: FormDataEntryValue | string | null): Layout {
  const v = String(value ?? "");
  if (v === "student") return "student";
  // One form, several buttons, and a button submits a single name and value —
  // so the configurable layout's format rides along in the value.
  if (v === "custom" || v === "custom-json") return "custom";
  return "parent";
}

/** The snapshot plus the one thing that is not in it: the family's code. */
type ExportRow = { id: string | null; snapshot: unknown; familyCode: string; enquiredAt: string | null };

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * `student_records` rows with their family code and enquiry date attached.
 * A record whose family somehow has no code is left out rather than exported
 * with a blank one, because a blank code would open a new account in the
 * other system instead of joining the family's.
 */
type JoinedRecord = {
  id?: string;
  snapshot: unknown;
  applications?: unknown;
};

function toExportRows(records: JoinedRecord[]): { rows: ExportRow[]; skipped: number } {
  const rows: ExportRow[] = [];
  let skipped = 0;
  for (const r of records) {
    const app = one(r.applications) as { created_at?: string; contacts?: unknown } | null;
    const contact = one(app?.contacts) as { family_code?: string | null } | null;
    const familyCode = contact?.family_code ?? "";
    if (!familyCode) {
      skipped += 1;
      continue;
    }
    rows.push({ id: r.id ?? null, snapshot: r.snapshot, familyCode, enquiredAt: app?.created_at ?? null });
  }
  return { rows, skipped };
}

/**
 * The student file is one row per child. The parent file is one row per
 * **family** — two siblings share a family, and sending it twice would have
 * their system either duplicate the account or reject the batch.
 */
function edAdminBody(layout: "parent" | "student", rows: ExportRow[]): string {
  if (layout === "student") {
    return toCsv([...STUDENT_COLUMNS], rows.map((r) => studentRow(r.snapshot as StudentRecordSnapshot, r.familyCode, { enquiredAt: r.enquiredAt })));
  }
  const seen = new Set<string>();
  const families: string[][] = [];
  for (const r of rows) {
    if (seen.has(r.familyCode)) continue;
    seen.add(r.familyCode);
    families.push(parentRow(r.snapshot as StudentRecordSnapshot, r.familyCode));
  }
  return toCsv([...PARENT_COLUMNS], families);
}

/**
 * Stored on the batch so a re-download reproduces the same file. The headers
 * are kept verbatim and `source_path` carries the layout, so the reader knows
 * these are not configurable columns.
 */
function layoutSnapshot(layout: "parent" | "student"): ExportColumn[] {
  const columns = layout === "parent" ? PARENT_COLUMNS : STUDENT_COLUMNS;
  return columns.map((header) => ({ header, source_path: `${LAYOUT_MARKER}${layout}`, transform: "none" as const }));
}

const SELECT =
  "id, application_id, snapshot, applications!inner(campus_id, intake_id, created_at, campuses(code), contacts!applications_contact_id_fkey(family_code))";

export async function POST(request: Request) {
  const ctx = await requireStaff("data.export");
  const form = await request.formData();
  const layout = layoutOf(form.get("layout"));
  const format = layout === "custom" && String(form.get("layout")) === "custom-json" ? "json" : "csv";
  const campus = String(form.get("campus") ?? "") || null;
  const intake = String(form.get("intake") ?? "") || null;
  // The parent file marks nothing, so it always covers the whole selection;
  // otherwise it would come back empty once the student file had been taken.
  const includeExported = form.get("all") === "1" || layout === "parent";

  let q = ctx.supabase.from("student_records").select(SELECT).order("generated_at", { ascending: false }).limit(500);
  if (campus) q = q.eq("applications.campus_id", campus);
  if (intake) q = q.eq("applications.intake_id", intake);
  if (!includeExported) q = q.eq("export_status", "pending");
  const { data: records } = await q;
  if (!records?.length) return new Response("Nothing to export", { status: 404 });

  const now = new Date();
  const campusCode = campus ? (one(one(records[0].applications)?.campuses)?.code ?? null) : null;

  if (layout === "parent" || layout === "student") {
    const { rows, skipped } = toExportRows(records);
    if (!rows.length) {
      return new Response("None of those families has a family code yet.", { status: 409 });
    }
    const filename = exportFilename("csv", now, campusCode).replace(/^students-/, `${layout}s-`);
    const body = edAdminBody(layout, rows);

    // Only the student file is the record of transfer.
    if (layout === "parent") return file(body, filename, "csv", skipped);

    const admin = createAdminClient();
    const { data: batch, error } = await admin
      .from("student_exports")
      .insert({
        campus_id: campus,
        intake_id: intake,
        format: "csv",
        record_count: rows.length,
        filename,
        columns_snapshot: layoutSnapshot(layout) as unknown as Json,
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error || !batch) return new Response(error?.message ?? "Could not record the batch", { status: 500 });
    // Only the records that actually went into the file are marked; one
    // without a family code was left out and must stay pending.
    await admin.rpc("mark_student_records_exported", {
      p_record_ids: rows.map((r) => r.id).filter((id): id is string => Boolean(id)),
      p_batch_id: batch.id,
    });
    await admin.from("audit_log").insert({
      actor_type: "staff",
      actor_id: ctx.userId,
      actor_label: ctx.profile.email,
      action: "student_records.exported",
      entity_type: "student_export",
      entity_id: batch.id,
      after: { record_count: rows.length, layout, skipped_without_family_code: skipped, campus_id: campus, intake_id: intake },
    });
    return file(body, filename, "csv", skipped);
  }

  // The configurable mapping.
  const { data: columnRows } = await ctx.supabase
    .from("export_columns")
    .select("header, source_path, transform")
    .eq("is_active", true)
    .order("position");
  const columns: ExportColumn[] = (columnRows ?? []).map((c) => ({ header: c.header, source_path: c.source_path, transform: c.transform }));
  if (!columns.length) return new Response("No export columns are active", { status: 400 });
  const filename = exportFilename(format, now, campusCode);
  const body = render(format, columns, records.map((r) => r.snapshot));

  const admin = createAdminClient();
  const { data: batch, error } = await admin
    .from("student_exports")
    .insert({ campus_id: campus, intake_id: intake, format, record_count: records.length, filename, columns_snapshot: columns as unknown as Json, created_by: ctx.userId })
    .select("id")
    .single();
  if (error || !batch) return new Response(error?.message ?? "Could not record the batch", { status: 500 });
  await admin.rpc("mark_student_records_exported", { p_record_ids: records.map((r) => r.id), p_batch_id: batch.id });
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
  const url = new URL(request.url);
  const batchId = url.searchParams.get("batch");
  if (!batchId) return new Response("Missing batch", { status: 400 });
  const { data: batch } = await ctx.supabase.from("student_exports").select("*").eq("id", batchId).maybeSingle();
  if (!batch) return new Response("Not found", { status: 404 });

  const { data: records } = await ctx.supabase.from("student_records").select(SELECT).eq("export_batch_id", batch.id);
  const stored = (Array.isArray(batch.columns_snapshot) ? batch.columns_snapshot : []) as unknown as ExportColumn[];
  const storedLayout = stored[0]?.source_path?.startsWith(LAYOUT_MARKER)
    ? (stored[0].source_path.slice(LAYOUT_MARKER.length) as "parent" | "student")
    : null;
  // A batch made from a template can be re-taken in either half: the student
  // file it recorded, or its companion parent file.
  const asked = url.searchParams.get("layout");
  const layout = storedLayout ? (asked === "parent" || asked === "student" ? asked : storedLayout) : null;

  let body: string;
  let filename = batch.filename;
  if (layout) {
    const { rows } = toExportRows(records ?? []);
    body = edAdminBody(layout, rows);
    filename = batch.filename.replace(/^(parent|student)s-/, `${layout}s-`);
  } else {
    body = render(batch.format, stored, (records ?? []).map((r) => r.snapshot));
  }

  await createAdminClient().from("audit_log").insert({
    actor_type: "staff",
    actor_id: ctx.userId,
    actor_label: ctx.profile.email,
    action: "student_export.downloaded_again",
    entity_type: "student_export",
    entity_id: batch.id,
    after: layout ? { layout } : null,
  });
  return file(body, filename, layout ? "csv" : batch.format);
}

function render(format: "csv" | "json", columns: ExportColumn[], snapshots: unknown[]): string {
  const headers = columns.map((c) => c.header);
  const rows = renderRows(snapshots, columns);
  return format === "json" ? toJson(headers, rows) : toCsv(headers, rows);
}

function file(body: string, filename: string, format: "csv" | "json", skipped = 0): Response {
  return new Response(body, {
    headers: {
      "content-type": format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
      // Read by nobody automatically; it is here so a puzzled count has an
      // explanation in the response rather than only in the audit log.
      ...(skipped ? { "x-records-skipped": String(skipped) } : {}),
    },
  });
}
