import { breakdownCsvRows, DIMENSIONS, groupBy, type Dimension, type FactRow } from "@/lib/analytics/breakdown";
import { toCsv } from "@/lib/enrolment/export";
import { daysAgoDateString, toSchoolDateString } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The breakdown table as CSV, with the same filters as the page. Counts only, no names. */
export async function GET(request: Request) {
  const ctx = await requireStaff("data.export");
  const sp = new URL(request.url).searchParams;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("to") ?? "") ? sp.get("to")! : toSchoolDateString(new Date());
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("from") ?? "") ? sp.get("from")! : daysAgoDateString(90);
  const dim: Dimension = (DIMENSIONS as readonly string[]).includes(sp.get("dim") ?? "") ? (sp.get("dim") as Dimension) : "campus";
  const campus = sp.get("campus");

  let q = ctx.supabase.from("v_application_facts").select("*").gte("enquired_at", `${from}T00:00:00+02:00`).lte("enquired_at", `${to}T23:59:59+02:00`).limit(5000);
  if (campus) q = q.eq("campus_id", campus);
  const { data, error } = await q;
  // A failed read must not become an empty spreadsheet. Silently exporting
  // nothing is worse than exporting nothing loudly: the file looks finished,
  // it gets sent on, and the audit log would record an export that never
  // happened. So it refuses, and writes nothing to the log.
  if (error) {
    return new Response(`The export could not be prepared: ${error.message}\n`, {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" },
    });
  }
  const { headers, rows } = breakdownCsvRows(dim, groupBy((data ?? []) as FactRow[], dim));
  await createAdminClient().from("audit_log").insert({
    actor_type: "staff",
    actor_id: ctx.userId,
    actor_label: ctx.profile.email,
    action: "analytics.exported",
    entity_type: "analytics",
    after: { from, to, dim, campus_id: campus },
  });
  return new Response(toCsv(headers, rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="hibiscus-analytics-${dim}-${from}-${to}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
