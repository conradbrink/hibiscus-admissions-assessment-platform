import { buildWorkbook } from "@/lib/enrolment/xlsx";
import { can } from "@/lib/permissions";
import { getStaff } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeCell, toSafeCsv } from "@/lib/stores/export";
import { REPORTS, REPORT_KINDS, buildReport, exportCell, type ReportKind } from "@/lib/stores/reports";
import { schoolToday } from "@/lib/stores/server";
import { listNamed } from "@/lib/stores/data";

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
  const catId = url.searchParams.get("category") || null;
  let category = catId;
  if (kind === "consumables" && catId) category = (await listNamed(ctx.supabase, "stores_categories")).find((c) => c.id === catId)?.name ?? null;
  const report = await buildReport(ctx.supabase, kind, { from, to, category }, today);
  const headers = report.columns.map((c) => c.label);
  const rows = [...report.rows, ...(report.footer ? [report.footer] : [])].map((r) => r.map((c, i) => exportCell(c, report.columns[i])));

  await createAdminClient().from("audit_log").insert({
    actor_type: "staff",
    actor_id: ctx.userId,
    actor_label: ctx.profile.email,
    action: "stores.report_exported",
    entity_type: "export",
    after: { kind, from, to, category: catId, rows: report.rows.length },
  });

  const stem = `hibiscus-stores-${kind}-${today}`;
  if (url.searchParams.get("format") === "xlsx") {
    const book = buildWorkbook([{ name: REPORTS[kind].title.slice(0, 31), headers, rows: rows.map((r) => r.map((c) => (c === null ? "" : String(safeCell(c))))) }]);
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
