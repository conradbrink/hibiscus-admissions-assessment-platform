import Link from "next/link";
import { AreaHeader } from "@/components/staff/area-header";
import { TRANSPORT_TABS, visibleAreaTabs } from "@/components/staff/nav-items";
import { EmptyState } from "@/components/staff/page-title";
import { formatDateRange, toSchoolDateString } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import { requireStaff } from "@/lib/staff/session";
import { ledgerBy, ledgerTotals, type LedgerTotals } from "@/lib/transport/ledger";
import { defaultTerm, termPeriodIds } from "@/lib/transport/periods";
import { loadAwaitingPayment, loadPeriods, loadStaffRiders, loadTransportSchools } from "@/lib/transport/staff";
import { toLedgerRider } from "@/lib/transport/staff-rider";

export const metadata = { title: "Transport earnings" };
export const dynamic = "force-dynamic";

const P = (minor: number) => formatMoney(minor, "BWP");

/**
 * What school transport brought in for a term, what the provider is owed
 * and has been paid, and what the school keeps. Every figure is
 * `lib/transport/ledger.ts` over the children's frozen lines, so this page,
 * the download and the payout screen add up the same way.
 */
export default async function TransportEarningsPage({ searchParams }: { searchParams: Promise<{ term?: string }> }) {
  const sp = await searchParams;
  const { supabase, permissions } = await requireStaff("transport.finance");
  const periods = await loadPeriods(supabase);
  const terms = periods.filter((p) => p.kind === "term");
  const term = terms.find((t) => t.id === sp.term) ?? defaultTerm(periods, toSchoolDateString(new Date()));
  const ids = term ? termPeriodIds(periods, term.id) : [];
  const [riders, awaiting, schools, allSchools] = await Promise.all([
    loadStaffRiders(supabase, { periodIds: ids, paidOnly: true }),
    loadAwaitingPayment(supabase, ids),
    loadTransportSchools(supabase),
    supabase.from("campuses").select("id", { count: "exact", head: true }).eq("is_active", true).eq("country", "BW"),
  ]);
  const lines = riders.map((r) => ({ ...toLedgerRider(r), school: r.school, schoolSort: r.schoolSort, periodId: r.booking.periodId }));
  const totals = ledgerTotals(lines);
  const bySchool = ledgerBy([...lines].sort((a, b) => a.schoolSort - b.schoolSort || a.school.localeCompare(b.school)), (l) => l.school);
  const order = new Map(periods.map((p, i) => [p.id, i]));
  const byPeriod = ledgerBy([...lines].sort((a, b) => (order.get(a.periodId) ?? 0) - (order.get(b.periodId) ?? 0)), (l) => l.periodId);
  const label = new Map(periods.map((p) => [p.id, p.label]));
  const scoped = (allSchools.count ?? 0) > schools.length;

  const tiles: Array<[string, number, string?]> = [
    ["Paid by parents", totals.paidByParent, `${totals.bookings} booking${totals.bookings === 1 ? "" : "s"}, ${totals.children} riding`],
    ["Refunded", totals.refunded],
    ["The provider's share", totals.providerShare],
    ["Paid to the provider", totals.paidToProvider],
    ["Still owed to the provider", totals.owedToProvider],
    ["Hibiscus keeps", totals.hibiscusKeeps],
  ];

  return (
    <>
      <AreaHeader
        title="Transport"
        tabsLabel="Pages"
        tabs={visibleAreaTabs(permissions, TRANSPORT_TABS, "/staff/transport/earnings")}
        description="Money in from parents, the provider's share and what the school keeps, for one term and its months. All amounts include VAT."
        viewActions={
          term ? (
            <Link href={`/staff/transport/earnings/export?term=${term.id}`} className="font-medium text-primary underline underline-offset-2" prefetch={false}>
              Download (Excel)
            </Link>
          ) : null
        }
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Term</span>
          <select name="term" defaultValue={term?.id ?? ""} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-9 rounded-md border border-border px-3 text-sm">
          Show
        </button>
      </form>

      {!term ? (
        <EmptyState>No term has been set up yet.</EmptyState>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            {term.label}, {formatDateRange(term.starts_on, term.ends_on)}, with its months.
            {scoped ? ` Only the schools you cover: ${schools.map((s) => s.name).join(", ")}.` : ""}
          </p>

          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tiles.map(([name, value, hint]) => (
              <div key={name} className="surface p-4">
                <p className="text-xs text-muted-foreground">{name}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{P(value)}</p>
                {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
              </div>
            ))}
          </div>

          <ul className="mb-6 space-y-1 text-sm">
            {totals.creditToDecide ? (
              <li>
                Children cancelled after the provider was paid for them: credits of up to <span className="font-medium">{P(totals.creditToDecide)}</span> are still to agree with the provider. Take them on the next payout.
              </li>
            ) : null}
            {totals.cancelled ? (
              <li>
                {totals.cancelled} {totals.cancelled === 1 ? "child was" : "children were"} cancelled after payment.
              </li>
            ) : null}
            <li className="text-muted-foreground">
              {awaiting.bookings
                ? `${awaiting.bookings} booking${awaiting.bookings === 1 ? " is" : "s are"} awaiting payment (${P(awaiting.amountMinor)}). Money is counted when it arrives.`
                : "No booking is awaiting payment."}
            </li>
          </ul>

          {lines.length ? (
            <>
              <Breakdown title="By school" rows={bySchool.map((g) => [g.key, g.totals])} />
              <Breakdown title="By booking" rows={byPeriod.map((g) => [label.get(g.key) ?? "", g.totals])} />
            </>
          ) : (
            <EmptyState>Nothing has been paid for {term.label} yet.</EmptyState>
          )}
        </>
      )}
    </>
  );
}

function Breakdown({ title, rows }: { title: string; rows: Array<[string, LedgerTotals]> }) {
  return (
    <section className="mb-6 space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="overflow-x-auto surface">
        <table className="data-table">
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium" />
              <th className="px-3 py-2 text-right font-medium">Riding</th>
              <th className="px-3 py-2 text-right font-medium">Paid by parents</th>
              <th className="px-3 py-2 text-right font-medium">Refunded</th>
              <th className="px-3 py-2 text-right font-medium">Provider&rsquo;s share</th>
              <th className="px-3 py-2 text-right font-medium">Still owed</th>
              <th className="px-3 py-2 text-right font-medium">Hibiscus keeps</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-xs tabular-nums">
            {rows.map(([name, t]) => (
              <tr key={name}>
                <td className="px-3 py-2 font-medium">{name}</td>
                <td className="px-3 py-2 text-right">{t.children}</td>
                <td className="px-3 py-2 text-right">{P(t.paidByParent)}</td>
                <td className="px-3 py-2 text-right">{P(t.refunded)}</td>
                <td className="px-3 py-2 text-right">{P(t.providerShare)}</td>
                <td className="px-3 py-2 text-right">{P(t.owedToProvider)}</td>
                <td className="px-3 py-2 text-right">{P(t.hibiscusKeeps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
