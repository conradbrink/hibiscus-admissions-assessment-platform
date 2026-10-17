import Link from "next/link";
import { AreaHeader } from "@/components/staff/area-header";
import { TRANSPORT_TABS, visibleAreaTabs } from "@/components/staff/nav-items";
import { EmptyState } from "@/components/staff/page-title";
import { formatDateRange, toSchoolDateString } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { prettyMobile } from "@/lib/phone";
import { requireStaff } from "@/lib/staff/session";
import { SERVICE_LABELS, weekdaysLabel } from "@/lib/transport/days";
import { defaultTerm, periodOptions, ridingPeriodIds } from "@/lib/transport/periods";
import { DAY_SLOTS, dayCounts } from "@/lib/transport/rider-list";
import { loadAwaitingPayment, loadPeriods, loadStaffRiders } from "@/lib/transport/staff";
import { byRoute, isRiding } from "@/lib/transport/staff-rider";

export const metadata = { title: "Transport riders" };
export const dynamic = "force-dynamic";

/**
 * Who is riding in a term or month: every child still booked on a paid
 * booking, in the order a route is planned, and the seats each run needs.
 * The same list, the same order and the same counts as the file the provider
 * is sent, because both are built by `lib/transport/rider-list.ts`.
 */
export default async function TransportRidersPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const sp = await searchParams;
  const { supabase, permissions } = await requireStaff("transport.read");
  const periods = await loadPeriods(supabase);
  const chosen = periods.find((p) => p.id === sp.period) ?? defaultTerm(periods, toSchoolDateString(new Date()));
  const ids = chosen ? ridingPeriodIds(periods, chosen.id) : [];
  const [riders, awaiting] = await Promise.all([loadStaffRiders(supabase, { periodIds: ids, paidOnly: true }), loadAwaitingPayment(supabase, ids)]);
  const riding = riders.filter(isRiding).sort(byRoute);
  const counts = dayCounts(riding);
  const label = new Map(periods.map((p) => [p.id, p.label]));
  const canExport = can(permissions, "transport.export");

  return (
    <>
      <AreaHeader
        title="Transport"
        tabsLabel="Pages"
        tabs={visibleAreaTabs(permissions, TRANSPORT_TABS, "/staff/transport/riders")}
        description="The children riding, for the provider to plan its routes. A child appears once the parent has paid, and leaves when their transport is cancelled."
        viewActions={
          chosen && canExport ? (
            <Link href={`/staff/transport/riders/export?period=${chosen.id}`} className="font-medium text-primary underline underline-offset-2" prefetch={false}>
              Download for the provider (Excel)
            </Link>
          ) : null
        }
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Riding in</span>
          <select name="period" defaultValue={chosen?.id ?? ""} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
            {periodOptions(periods).map((p) => (
              <option key={p.id} value={p.id}>
                {p.indent ? ` ${p.label}` : p.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-9 rounded-md border border-border px-3 text-sm">
          Show
        </button>
      </form>

      {!chosen ? (
        <EmptyState>No term has been set up yet. Add one under the Settings tab.</EmptyState>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            {chosen.label}, {formatDateRange(chosen.starts_on, chosen.ends_on)}
            {chosen.kind === "term" ? ", with the bookings for each of its months" : ", with the bookings for the whole term"}.{" "}
            <span className="font-medium text-foreground">{riding.length}</span> {riding.length === 1 ? "child is" : "children are"} riding.
            {awaiting.bookings ? ` ${awaiting.bookings} more booking${awaiting.bookings === 1 ? " is" : "s are"} awaiting payment.` : ""}
          </p>

          {riding.length ? (
            <>
              <section className="mb-6 space-y-2">
                <h2 className="text-sm font-semibold">Seats on each run</h2>
                <div className="overflow-x-auto surface">
                  <table className="data-table">
                    <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Area</th>
                        <th className="px-3 py-2 font-medium">School</th>
                        <th className="px-3 py-2 text-right font-medium">Children</th>
                        {DAY_SLOTS.map((s) => (
                          <th key={s} className="px-2 py-2 text-right font-medium">
                            {s.slice(0, 1).toUpperCase()}
                            {s.slice(1, 3)} {s.endsWith("am") ? "AM" : "PM"}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border text-xs tabular-nums">
                      {[...counts.rows, counts.total].map((c) => (
                        <tr key={`${c.area}-${c.school}`} className={c === counts.total ? "font-semibold" : undefined}>
                          <td className="px-3 py-2">{c.area}</td>
                          <td className="px-3 py-2">{c.school}</td>
                          <td className="px-3 py-2 text-right">{c.children}</td>
                          {DAY_SLOTS.map((s) => (
                            <td key={s} className="px-2 py-2 text-right">
                              {c.slots[s] || ""}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="space-y-2">
                <h2 className="text-sm font-semibold">Children</h2>
                <div className="overflow-x-auto surface">
                  <table className="data-table">
                    <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Child</th>
                        <th className="px-3 py-2 font-medium">School</th>
                        <th className="px-3 py-2 font-medium">Service and days</th>
                        <th className="px-3 py-2 font-medium">Pick-up</th>
                        <th className="px-3 py-2 font-medium">Parent</th>
                        <th className="px-3 py-2 font-medium">Booking</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border text-xs">
                      {riding.map((r) => (
                        <tr key={r.id}>
                          <td className="px-3 py-2">
                            <span className="text-sm font-medium">
                              {r.firstName} {r.lastName}
                            </span>
                            <span className="ml-2 text-muted-foreground">{r.grade}</span>
                          </td>
                          <td className="px-3 py-2">{r.school}</td>
                          <td className="px-3 py-2">
                            {SERVICE_LABELS[r.service]}
                            <br />
                            <span className="text-muted-foreground">{weekdaysLabel(r.days)}</span>
                          </td>
                          <td className="px-3 py-2">
                            {r.booking.address}
                            <br />
                            <span className="text-muted-foreground">
                              {r.booking.area}
                              {r.booking.landmark ? ` · ${r.booking.landmark}` : ""}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            {r.booking.parentFirstName} {r.booking.parentLastName}
                            {r.booking.mobile ? <span className="block text-muted-foreground">{prettyMobile(r.booking.mobile)}</span> : null}
                          </td>
                          <td className="px-3 py-2">
                            <Link href={`/staff/transport/bookings/${r.bookingId}`} className="hover:underline">
                              {r.reference}
                            </Link>
                            <span className="block text-muted-foreground">{label.get(r.booking.periodId) ?? ""}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : (
            <EmptyState>Nobody is riding in {chosen.label} yet. Children appear here once their parent has paid.</EmptyState>
          )}
        </>
      )}
    </>
  );
}
