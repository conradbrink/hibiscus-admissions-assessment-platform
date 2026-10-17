import { buildWorkbook } from "@/lib/enrolment/xlsx";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import { requireStaff } from "@/lib/staff/session";
import { auditedWorkbook, refused } from "@/lib/transport/download";
import { payoutFilename, payoutSheets, type PayoutLine } from "@/lib/transport/payout";
import { loadPeriods, loadProviders, loadStaffRiders } from "@/lib/transport/staff";
import { byRoute } from "@/lib/transport/staff-rider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The remittance for a recorded payout: which children the payment covered
 * and which credits it took, for the provider to match against its own
 * invoice. It names the children, because that is how the provider knows
 * them. Audited like every transport download.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireStaff("transport.finance");
  const now = new Date();
  try {
    const { data: payout, error } = await ctx.supabase.from("transport_payouts").select("*, transport_payout_items(rider_id, kind, amount_minor)").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!payout) return new Response("Not found\n", { status: 404 });
    const items = payout.transport_payout_items ?? [];
    const [riders, periods, providers] = await Promise.all([
      loadStaffRiders(ctx.supabase, { riderIds: [...new Set(items.map((i) => i.rider_id))] }),
      loadPeriods(ctx.supabase),
      loadProviders(ctx.supabase),
    ]);
    const byId = new Map(riders.map((r) => [r.id, r]));
    const lines: PayoutLine[] = items
      .flatMap((i) => {
        const rider = byId.get(i.rider_id);
        return rider ? [{ kind: i.kind, rider, amountMinor: Number(i.amount_minor) }] : [];
      })
      .sort((a, b) => (a.kind === b.kind ? byRoute(a.rider, b.rider) : a.kind === "charge" ? -1 : 1));
    const shown = lines.reduce((s, l) => s + (l.kind === "charge" ? l.amountMinor : -l.amountMinor), 0);
    const provider = providers.find((p) => p.id === payout.provider_id);
    const about: Array<[string, string]> = [
      ["Paid to", provider?.name ?? "The transport provider"],
      ["Paid on", formatDate(payout.paid_on)],
      ["Bank reference", payout.bank_reference],
      ["Total paid", formatMoney(Number(payout.total_minor), payout.currency)],
      ...(shown !== Number(payout.total_minor)
        ? ([["Lines in this file", `${formatMoney(shown, payout.currency)}: only the children at the schools the person who took this file covers.`]] as Array<[string, string]>)
        : []),
      ["Amounts", "In pula, including VAT. A credit is shown as a negative amount."],
      ["Taken", formatDateTime(now)],
      ["Taken by", ctx.profile.full_name || ctx.profile.email],
    ];
    return await auditedWorkbook(
      ctx,
      { action: "transport.payout_exported", entityType: "transport_payout", entityId: payout.id, after: { lines: lines.length, total_minor: payout.total_minor } },
      payoutFilename(provider?.code ?? "provider", "remittance", payout.paid_on, payout.bank_reference),
      new Uint8Array(buildWorkbook(payoutSheets(lines, new Map(periods.map((p) => [p.id, p])), about)))
    );
  } catch (e) {
    return refused("The remittance", e);
  }
}
