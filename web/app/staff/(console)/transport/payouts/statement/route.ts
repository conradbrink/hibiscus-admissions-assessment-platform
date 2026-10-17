import { buildWorkbook } from "@/lib/enrolment/xlsx";
import { formatDateTime } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import { requireStaff } from "@/lib/staff/session";
import { auditedWorkbook, refused } from "@/lib/transport/download";
import { payoutFilename, payoutSheets, statementLines } from "@/lib/transport/payout";
import { termPeriodIds } from "@/lib/transport/periods";
import { loadPeriods, loadProviders, loadStaffRiders } from "@/lib/transport/staff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the provider is owed now, before the bank payment: every child still
 * booked on a paid booking and not yet paid for. For checking against the
 * provider's invoice; the payout recorded afterwards is the record of what
 * was actually paid.
 */
export async function GET(request: Request) {
  const ctx = await requireStaff("transport.finance");
  const url = new URL(request.url);
  const now = new Date();
  try {
    const [periods, providers] = await Promise.all([loadPeriods(ctx.supabase), loadProviders(ctx.supabase)]);
    const term = periods.find((p) => p.id === url.searchParams.get("term") && p.kind === "term") ?? null;
    const provider = providers.find((p) => p.id === url.searchParams.get("provider")) ?? providers.find((p) => p.is_active) ?? null;
    if (!provider) return new Response("No transport provider is set up.\n", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
    const riders = await loadStaffRiders(ctx.supabase, { paidOnly: true, ...(term ? { periodIds: termPeriodIds(periods, term.id) } : {}) });
    const lines = statementLines(riders, provider.id);
    const total = lines.reduce((s, l) => s + l.amountMinor, 0);
    const about: Array<[string, string]> = [
      ["Owed to", provider.name],
      ["Covers", term ? `${term.label} and its months` : "Every term"],
      ["Total owed", formatMoney(total, "BWP")],
      ["Children", String(lines.length)],
      ["Amounts", "In pula, including VAT. Credits for cancelled children are agreed separately and taken on the payment."],
      ["Taken", formatDateTime(now)],
      ["Taken by", ctx.profile.full_name || ctx.profile.email],
    ];
    return await auditedWorkbook(
      ctx,
      { action: "transport.payout_statement_exported", entityType: "transport_providers", entityId: provider.id, after: { term: term?.label ?? null, lines: lines.length, total_minor: total } },
      payoutFilename(provider.code, "statement", now),
      new Uint8Array(buildWorkbook(payoutSheets(lines, new Map(periods.map((p) => [p.id, p])), about)))
    );
  } catch (e) {
    return refused("The statement", e);
  }
}
