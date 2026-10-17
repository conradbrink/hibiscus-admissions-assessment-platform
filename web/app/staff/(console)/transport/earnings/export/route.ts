import { buildWorkbook } from "@/lib/enrolment/xlsx";
import { formatDateTime, toSchoolDateString } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";
import { auditedWorkbook, refused } from "@/lib/transport/download";
import { earningsSheets } from "@/lib/transport/earnings";
import { termPeriodIds } from "@/lib/transport/periods";
import { loadAwaitingPayment, loadPayoutsFor, loadPeriods, loadStaffRiders, loadTransportSchools } from "@/lib/transport/staff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A term's transport earnings as a workbook for finance: the totals, by
 * school, by booking, and one row per child's line with the payouts that
 * covered it. Lines carry the booking reference and the child's place on it,
 * not a name. Audited like every transport download.
 */
export async function GET(request: Request) {
  const ctx = await requireStaff("transport.finance");
  const termId = new URL(request.url).searchParams.get("term") ?? "";
  const now = new Date();
  try {
    const periods = await loadPeriods(ctx.supabase);
    const term = periods.find((p) => p.id === termId && p.kind === "term");
    if (!term) return new Response("Choose a term first.\n", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
    const ids = termPeriodIds(periods, term.id);
    const [riders, awaiting, schools] = await Promise.all([
      loadStaffRiders(ctx.supabase, { periodIds: ids, paidOnly: true }),
      loadAwaitingPayment(ctx.supabase, ids),
      loadTransportSchools(ctx.supabase),
    ]);
    const payouts = await loadPayoutsFor(ctx.supabase, riders);
    const sheets = earningsSheets(riders, new Map(periods.map((p) => [p.id, p])), {
      periodLabel: term.label,
      schools: schools.map((s) => s.name),
      takenAt: formatDateTime(now),
      takenBy: ctx.profile.full_name || ctx.profile.email,
      awaiting,
      payouts,
    });
    const slug = term.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return await auditedWorkbook(
      ctx,
      { action: "transport.earnings_exported", entityType: "transport_periods", entityId: term.id, after: { term: term.label, lines: riders.length } },
      `transport-earnings-${slug || "term"}-${toSchoolDateString(now)}.xlsx`,
      new Uint8Array(buildWorkbook(sheets))
    );
  } catch (e) {
    return refused("The earnings report", e);
  }
}
