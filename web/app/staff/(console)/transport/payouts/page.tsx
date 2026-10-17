import Link from "next/link";
import { AreaHeader } from "@/components/staff/area-header";
import { TRANSPORT_TABS, visibleAreaTabs } from "@/components/staff/nav-items";
import { EmptyState } from "@/components/staff/page-title";
import { buttonVariants } from "@/components/ui/button";
import { formatDate } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import { ledgerTotals } from "@/lib/transport/ledger";
import { loadStaffRiders } from "@/lib/transport/staff";
import { toLedgerRider } from "@/lib/transport/staff-rider";

export const metadata = { title: "Transport payouts" };
export const dynamic = "force-dynamic";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * Every payment recorded to the transport provider, newest first, and what is
 * owed now across every term. A payout is recorded after the bank payment is
 * made and never changes; a mistake is corrected by the next one.
 */
export default async function TransportPayoutsPage() {
  const { supabase, permissions } = await requireStaff("transport.finance");
  const [{ data: payouts, error }, riders] = await Promise.all([
    supabase
      .from("transport_payouts")
      .select("id, paid_on, bank_reference, total_minor, currency, note, created_at, transport_providers!transport_payouts_provider_id_fkey(name), staff_profiles!transport_payouts_recorded_by_fkey(full_name, email), transport_payout_items(kind)")
      .order("paid_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200),
    loadStaffRiders(supabase, { paidOnly: true }),
  ]);
  if (error) throw new Error(error.message);
  const totals = ledgerTotals(riders.map(toLedgerRider));
  const canRecord = can(permissions, "finance.write");

  return (
    <>
      <AreaHeader
        title="Transport"
        tabsLabel="Pages"
        tabs={visibleAreaTabs(permissions, TRANSPORT_TABS, "/staff/transport/payouts")}
        description="Payments made to the transport provider. Pay at the bank first, then record the payment here with the bank's reference."
        actions={
          canRecord ? (
            <Link href="/staff/transport/payouts/new" className={buttonVariants({ size: "sm" })}>
              Record a payment
            </Link>
          ) : null
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="surface p-4">
          <p className="text-xs text-muted-foreground">Owed to the provider now</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(totals.owedToProvider, "BWP")}</p>
          <p className="mt-1 text-xs text-muted-foreground">Children booked and paid for by parents, not yet paid to the provider</p>
        </div>
        <div className="surface p-4">
          <p className="text-xs text-muted-foreground">Paid to the provider so far</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(totals.paidToProvider, "BWP")}</p>
        </div>
        <div className="surface p-4">
          <p className="text-xs text-muted-foreground">Credits still to decide</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(totals.creditToDecide, "BWP")}</p>
          <p className="mt-1 text-xs text-muted-foreground">At most, for children cancelled after the provider was paid</p>
        </div>
      </div>

      {(payouts ?? []).length ? (
        <div className="overflow-x-auto surface">
          <table className="data-table">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Paid on</th>
                <th className="px-3 py-2 font-medium">Bank reference</th>
                <th className="px-3 py-2 font-medium">Provider</th>
                <th className="px-3 py-2 text-right font-medium">Children</th>
                <th className="px-3 py-2 text-right font-medium">Credits</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 font-medium">Recorded by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-xs">
              {(payouts ?? []).map((p) => {
                const items = p.transport_payout_items ?? [];
                const by = one(p.staff_profiles);
                return (
                  <tr key={p.id}>
                    <td className="px-3 py-2">
                      <Link href={`/staff/transport/payouts/${p.id}`} className="text-sm font-medium hover:underline">
                        {formatDate(p.paid_on)}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{p.bank_reference}</td>
                    <td className="px-3 py-2">{one(p.transport_providers)?.name ?? ""}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{items.filter((i) => i.kind === "charge").length}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{items.filter((i) => i.kind === "credit").length}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(Number(p.total_minor), p.currency)}</td>
                    <td className="px-3 py-2">{by?.full_name || by?.email || ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>No payment to the provider has been recorded yet.</EmptyState>
      )}
    </>
  );
}
