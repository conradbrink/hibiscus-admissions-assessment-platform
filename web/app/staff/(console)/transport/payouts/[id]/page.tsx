import Link from "next/link";
import { notFound } from "next/navigation";
import { Fact } from "@/components/crm/bits";
import { PageTitle } from "@/components/staff/page-title";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import { requireStaff } from "@/lib/staff/session";
import { loadPeriods, loadStaffRiders } from "@/lib/transport/staff";
import { byRoute } from "@/lib/transport/staff-rider";

export const metadata = { title: "Transport payout" };

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * One recorded payment to the provider and the children it covered. A
 * campus-scoped reader sees every payout's total but only their own schools'
 * lines, so the page says when the lines shown are not the whole payment.
 */
export default async function TransportPayoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await requireStaff("transport.finance");
  const { data: payout, error } = await supabase
    .from("transport_payouts")
    .select("*, transport_providers!transport_payouts_provider_id_fkey(name), staff_profiles!transport_payouts_recorded_by_fkey(full_name, email), transport_payout_items(rider_id, kind, amount_minor)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!payout) notFound();

  const items = payout.transport_payout_items ?? [];
  const [riders, periods] = await Promise.all([loadStaffRiders(supabase, { riderIds: [...new Set(items.map((i) => i.rider_id))] }), loadPeriods(supabase)]);
  const byId = new Map(riders.map((r) => [r.id, r]));
  const label = new Map(periods.map((p) => [p.id, p.label]));
  const lines = items
    .map((i) => ({ ...i, rider: byId.get(i.rider_id) }))
    .sort((a, b) => (a.kind === b.kind ? (a.rider && b.rider ? byRoute(a.rider, b.rider) : 0) : a.kind === "charge" ? -1 : 1));
  const shown = lines.reduce((s, l) => s + (l.kind === "charge" ? 1 : -1) * Number(l.amount_minor), 0);
  const by = one(payout.staff_profiles);

  return (
    <>
      <PageTitle
        back={{ href: "/staff/transport/payouts", label: "Transport payouts" }}
        title={`${formatMoney(Number(payout.total_minor), payout.currency)} to ${one(payout.transport_providers)?.name ?? "the provider"}`}
        description={`Paid on ${formatDate(payout.paid_on)}, bank reference ${payout.bank_reference}.`}
      >
        <Link href={`/staff/transport/payouts/${payout.id}/export`} prefetch={false} className="text-sm font-medium text-primary underline underline-offset-2">
          Download the remittance (Excel)
        </Link>
      </PageTitle>

      <section className="surface mb-6 grid gap-4 p-4 sm:grid-cols-3">
        <Fact label="Recorded">
          {formatDateTime(payout.created_at)}
          {by ? ` by ${by.full_name || by.email}` : ""}
        </Fact>
        <Fact label="Children paid for">{items.filter((i) => i.kind === "charge").length}</Fact>
        <Fact label="Credits taken">{items.filter((i) => i.kind === "credit").length}</Fact>
        {payout.note ? <Fact label="Note">{payout.note}</Fact> : null}
      </section>

      {shown !== Number(payout.total_minor) ? (
        <p className="mb-3 text-xs text-muted-foreground">
          The lines below add up to {formatMoney(shown, payout.currency)}: the rest of this payment was for children at schools you do not cover.
        </p>
      ) : null}

      <div className="overflow-x-auto surface">
        <table className="data-table">
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Line</th>
              <th className="px-3 py-2 font-medium">Child</th>
              <th className="px-3 py-2 font-medium">School</th>
              <th className="px-3 py-2 font-medium">Booking</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-xs">
            {lines.map((l) => (
              <tr key={`${l.rider_id}-${l.kind}`}>
                <td className="px-3 py-2">{l.kind === "charge" ? "Charge" : "Credit"}</td>
                <td className="px-3 py-2">{l.rider ? `${l.rider.firstName} ${l.rider.lastName}` : "—"}</td>
                <td className="px-3 py-2">{l.rider?.school ?? "—"}</td>
                <td className="px-3 py-2">
                  {l.rider ? (
                    <Link href={`/staff/transport/bookings/${l.rider.bookingId}`} className="hover:underline">
                      {l.rider.reference}
                    </Link>
                  ) : null}
                  <span className="block text-muted-foreground">{l.rider ? (label.get(l.rider.booking.periodId) ?? "") : ""}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney((l.kind === "charge" ? 1 : -1) * Number(l.amount_minor), payout.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
