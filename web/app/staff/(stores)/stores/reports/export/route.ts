import { buildWorkbook } from "@/lib/enrolment/xlsx";
import { can } from "@/lib/permissions";
import { getStaff } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { toSafeCsv } from "@/lib/stores/export";
import { REPORTS, REPORT_KINDS, buildReport, exportCell, type ReportKind } from "@/lib/stores/reports";
import { schoolToday } from "@/lib/stores/server";
import { listNamed } from "@/lib/stores/data";
import { MOVEMENT_TYPES, type MovementType } from "@/lib/stores/rules";
import { isUuid } from "@/lib/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A Stores report as a file: CSV (opens in Excel with numbers as numbers) or
 * .xlsx. Read through the caller's own client, so the rows are what they may
 * see, and audited with the report and its filters.
 */
export async function GET(request: Request) {
  const ctx = await getStaff();
  if (!ctx || !can(ctx.permissions, "stores.read")) return new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") as ReportKind;
  if (!REPORT_KINDS.includes(kind)) return new Response("Unknown report.", { status: 400 });
  const today = schoolToday();
  const from = DATE.test(url.searchParams.get("from") ?? "") ? url.searchParams.get("from")! : "2000-01-01";
  const to = DATE.test(url.searchParams.get("to") ?? "") ? url.searchParams.get("to")! : today;
  // Anything that is not an id is dropped rather than handed to the query,
  // where it would fail the whole download with a database error.
  const id = (name: string) => {
    const v = url.searchParams.get(name);
    return isUuid(v) ? v : null;
  };
  const catId = id("category");
  let category = catId;
  if (kind === "consumables" && catId) category = (await listNamed(ctx.supabase, "stores_categories", { includeInactive: true })).find((c) => c.id === catId)?.name ?? null;
  const t = url.searchParams.get("type");
  const movement = { item: id("item"), type: MOVEMENT_TYPES.includes(t as MovementType) ? (t as MovementType) : null, employee: id("employee"), department: id("department") };
  const report = await buildReport(ctx.supabase, kind, { from, to, category, ...(kind === "movements" ? movement : {}) }, today);
  const headers = report.columns.map((c) => c.label);
  const rows = [...report.rows, ...(report.footer ? [report.footer] : [])].map((r) => r.map((c, i) => exportCell(c, report.columns[i])));

  await createAdminClient().from("audit_log").insert({
    actor_type: "staff",
    actor_id: ctx.userId,
    actor_label: ctx.profile.email,
    action: "stores.report_exported",
    entity_type: "export",
    after: { kind, from, to, category: catId, ...(kind === "movements" ? movement : {}), rows: report.rows.length },
  });

  const stem = `hibiscus-stores-${kind}-${today}`;
  if (url.searchParams.get("format") === "xlsx") {
    // No apostrophe here: a workbook cell written as an inline string is text
    // and is never run as a formula, so the CSV's guard would only show up as
    // a stray ' in front of the name. Numbers go in as numbers.
    const book = buildWorkbook([{ name: REPORTS[kind].title.slice(0, 31), headers, rows: rows.map((r) => r.map((c) => (c === null ? "" : c))) }]);
    return new Response(new Uint8Array(book), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${stem}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return new Response(toSafeCsv(headers, rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${stem}.csv"`, "Cache-Control": "no-store" },
  });
}
