import Link from "next/link";
import { Pagination, Pill, queryBuilder } from "@/components/crm/bits";
import { AreaHeader } from "@/components/staff/area-header";
import { TRANSPORT_TABS, visibleAreaTabs } from "@/components/staff/nav-items";
import { EmptyState } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import { requireStaff } from "@/lib/staff/session";
import { BOOKING_STATUS_LABELS, BOOKING_STATUS_TONE, isBookingStatus } from "@/lib/transport/labels";
import { periodOptions, termPeriodIds } from "@/lib/transport/periods";
import { loadPeriods, loadTransportSchools } from "@/lib/transport/staff";

export const metadata = { title: "Transport bookings" };

const PAGE = 50;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

type Search = { status?: string; period?: string; campus?: string; q?: string; page?: string };

/**
 * Every school transport booking this person may see, newest first.
 *
 * A booking has no campus of its own; its children do. The policies show a
 * booking when any of its children is at a school the person can see, and
 * show only those children, so a campus-scoped coordinator reads their own
 * schools' lines of a booking that also covers another. The school filter is
 * the same rule in the query: an inner join on the children at that school.
 */
export default async function TransportBookingsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { supabase, permissions } = await requireStaff("transport.read");
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const status = isBookingStatus(sp.status) ? sp.status : null;

  const [periods, schools] = await Promise.all([loadPeriods(supabase), loadTransportSchools(supabase)]);
  const chosen = periods.find((p) => p.id === sp.period) ?? null;

  let q = supabase
    .from("transport_bookings")
    .select(
      "id, reference, status, created_at, period_id, parent_first_name, parent_last_name, transport_booking_riders!transport_booking_riders_booking_id_fkey!inner(id, position, first_name, status, amount_minor, campus_id, campuses!transport_booking_riders_campus_id_fkey(name))",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (status) q = q.eq("status", status);
  // A term's bookings include its months': "Term 1" is everybody riding in it.
  if (chosen) q = q.in("period_id", chosen.kind === "term" ? termPeriodIds(periods, chosen.id) : [chosen.id]);
  if (sp.campus) q = q.eq("transport_booking_riders.campus_id", sp.campus);
  const term = (sp.q ?? "").replace(/[%,()]/g, " ").trim();
  if (term) q = q.or(`reference.ilike.%${term}%,parent_first_name.ilike.%${term}%,parent_last_name.ilike.%${term}%,email_normalised.ilike.%${term.toLowerCase()}%`);
  const { data: bookings, count, error } = await q;
  if (error) throw new Error(error.message);

  const label = new Map(periods.map((p) => [p.id, p.label]));
  // Bookings somebody has been asked to look at: a late or double payment, a
  // refund to decide. Marked on the row so they are not missed.
  const { data: openTasks } = (bookings ?? []).length
    ? await supabase.from("tasks").select("transport_booking_id").in("transport_booking_id", (bookings ?? []).map((b) => b.id)).eq("status", "open")
    : { data: [] as Array<{ transport_booking_id: string | null }> };
  const needsLook = new Set((openTasks ?? []).map((t) => t.transport_booking_id));
  const qs = queryBuilder({ status: sp.status, period: sp.period, campus: sp.campus, q: sp.q });
  const rows = bookings ?? [];

  return (
    <>
      <AreaHeader
        title="Transport"
        tabsLabel="Pages"
        tabs={visibleAreaTabs(permissions, TRANSPORT_TABS, "/staff/transport")}
        description="Every school transport booking you can see, newest first. A booking shows only the children at schools you cover."
      />

      <div className="mb-3 flex flex-wrap gap-2">
        <Pill href={qs({ status: undefined, page: undefined })} active={!status}>
          All
        </Pill>
        {Object.entries(BOOKING_STATUS_LABELS).map(([value, text]) => (
          <Pill key={value} href={qs({ status: value, page: undefined })} active={status === value}>
            {text}
          </Pill>
        ))}
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        {status ? <input type="hidden" name="status" value={status} /> : null}
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Reference, parent or email"
            className="h-9 w-56 rounded-md border border-border bg-background px-2 text-sm"
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Booked for</span>
          <select name="period" defaultValue={chosen?.id ?? ""} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
            <option value="">Any term or month</option>
            {periodOptions(periods).map((p) => (
              <option key={p.id} value={p.id}>
                {p.indent ? ` ${p.label}` : p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">School</span>
          <select name="campus" defaultValue={sp.campus ?? ""} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
            <option value="">Every school</option>
            {schools.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-9 rounded-md border border-border px-3 text-sm">
          Apply
        </button>
        {sp.q || sp.period || sp.campus ? (
          <Link href={qs({ q: undefined, period: undefined, campus: undefined, page: undefined })} className="h-9 px-2 text-sm leading-9 text-muted-foreground underline">
            Clear
          </Link>
        ) : null}
      </form>

      {rows.length ? (
        <div className="overflow-x-auto surface">
          <table className="data-table">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Booking</th>
                <th className="px-3 py-2 font-medium">Children</th>
                <th className="px-3 py-2 font-medium">Schools</th>
                <th className="px-3 py-2 font-medium">Booked for</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Booked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((b) => {
                const riders = [...(b.transport_booking_riders ?? [])].sort((x, y) => x.position - y.position);
                const schoolsOn = [...new Set(riders.map((r) => one(r.campuses)?.name ?? "School"))];
                return (
                  <tr key={b.id}>
                    <td className="px-3 py-2">
                      <Link href={`/staff/transport/bookings/${b.id}`} className="font-medium hover:underline">
                        {b.reference}
                      </Link>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {b.parent_first_name} {b.parent_last_name}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {riders.map((r, i) => (
                        <span key={r.id} className={r.status === "cancelled" ? "text-muted-foreground line-through" : undefined}>
                          {i ? ", " : ""}
                          {r.first_name}
                        </span>
                      ))}
                    </td>
                    <td className="px-3 py-2 text-xs">{schoolsOn.join(", ")}</td>
                    <td className="px-3 py-2 text-xs">{label.get(b.period_id) ?? "—"}</td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums">{formatMoney(riders.reduce((s, r) => s + Number(r.amount_minor), 0), "BWP")}</td>
                    <td className="px-3 py-2">
                      <Badge variant={BOOKING_STATUS_TONE[b.status]}>{BOOKING_STATUS_LABELS[b.status]}</Badge>
                      {needsLook.has(b.id) ? (
                        <Badge variant="destructive" className="ml-1">
                          Task
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs">{formatDate(b.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>No bookings match. Bookings appear here as parents book on the public transport page.</EmptyState>
      )}
      <Pagination page={page} pages={Math.max(1, Math.ceil((count ?? 0) / PAGE))} qs={qs} />
    </>
  );
}
