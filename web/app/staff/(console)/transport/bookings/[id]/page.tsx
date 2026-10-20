import { notFound } from "next/navigation";
import { Fact } from "@/components/crm/bits";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatDateRange, formatDateTime } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import { can, closesTransportTasks } from "@/lib/permissions";
import { prettyMobile } from "@/lib/phone";
import { requireStaff } from "@/lib/staff/session";
import { HOUSEHOLD_LABELS, SERVICE_LABELS, weekdaysLabel } from "@/lib/transport/days";
import { BOOKING_STATUS_LABELS, BOOKING_STATUS_TONE } from "@/lib/transport/labels";
import { providerShareOf } from "@/lib/transport/ledger";
import { cancelTransportChildren, closeTransportTask, recordTransportRefund } from "./actions";

export const metadata = { title: "Transport booking" };

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * One booking: who booked, where from, each child's priced line, and what
 * happened to the money. Cancelling and refunding are here, each behind the
 * permission its database function asks for.
 *
 * The children shown are the ones at schools this person covers. Cancelling
 * needs every child on the booking to be one of them, and the function says
 * so if not; the page does not try to guess it.
 */
export default async function TransportBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, permissions } = await requireStaff("transport.read");

  const [{ data: booking, error }, ridersRes, requestsRes, paymentsRes, emailsRes, tasksRes] = await Promise.all([
    supabase
      .from("transport_bookings")
      .select(
        "*, transport_periods!transport_bookings_period_id_fkey(label, kind, starts_on, ends_on), transport_areas!transport_bookings_area_id_fkey(name), transport_zones!transport_bookings_zone_id_fkey(label), transport_terms!transport_bookings_terms_id_fkey(version), transport_providers!transport_bookings_provider_id_fkey(name)"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("transport_booking_riders")
      // The provider's share is finance's table: empty for everybody else.
      .select(
        "*, campuses!transport_booking_riders_campus_id_fkey(name), grades!transport_booking_riders_grade_id_fkey(name), transport_payout_items(kind, amount_minor, payout_id), transport_rider_provider_shares(provider_amount_minor)"
      )
      .eq("booking_id", id)
      .order("position"),
    // Finance's rows: empty for anybody the payment policies do not let in.
    supabase.from("payment_requests").select("id, status, amount_minor, paid_minor, currency, due_at, paid_at, created_at").eq("transport_booking_id", id).order("created_at"),
    supabase.from("payments").select("id, status, amount_minor, currency, provider, method, created_at, failure_reason").eq("transport_booking_id", id).order("created_at"),
    supabase.from("email_messages").select("id, template_key, status, to_email, subject, created_at").eq("transport_booking_id", id).order("created_at"),
    // The tasks the settlement and the cancel form raise about this booking.
    // A coordinator cannot open the Tasks page, so this is where they see them.
    supabase.from("tasks").select("id, title, details, priority, created_at").eq("transport_booking_id", id).eq("status", "open").order("created_at"),
  ]);
  if (error) throw new Error(error.message);
  if (!booking) notFound();

  const riders = ridersRes.data ?? [];
  const period = one(booking.transport_periods);
  const canCancel = can(permissions, "transport.manage") && (booking.status === "awaiting_payment" || booking.status === "paid");
  const canRefund = can(permissions, "transport.finance") && can(permissions, "finance.write") && booking.paid_at !== null;
  const seesProvider = can(permissions, "transport.finance");
  const closesTasks = closesTransportTasks(permissions);
  // The ledger's rule, so a child cancelled before the provider was paid for
  // them counts nothing here, as on the earnings page.
  const shareOf = (r: (typeof riders)[number]) =>
    providerShareOf({
      status: r.status,
      providerAmountMinor: Number(one(r.transport_rider_provider_shares)?.provider_amount_minor ?? 0),
      items: (r.transport_payout_items ?? []).map((i) => ({ kind: i.kind, amountMinor: Number(i.amount_minor) })),
    });
  const booked = riders.filter((r) => r.status === "booked");
  const total = riders.reduce((s, r) => s + Number(r.amount_minor), 0);
  const anonymised = booking.anonymised_at !== null;

  return (
    <>
      <PageTitle
        back={{ href: "/staff/transport", label: "Transport bookings" }}
        title={booking.reference}
        description={`${period?.label ?? "Transport"}${period ? `, ${formatDateRange(period.starts_on, period.ends_on)}` : ""}. Booked ${formatDateTime(booking.created_at)}.`}
      >
        <Badge variant={BOOKING_STATUS_TONE[booking.status]}>{BOOKING_STATUS_LABELS[booking.status]}</Badge>
      </PageTitle>

      {anonymised ? (
        <p className="surface mb-4 p-3 text-sm text-muted-foreground">
          This booking&rsquo;s personal details were removed on {formatDate(booking.anonymised_at)}, as the retention rules require. The amounts are kept.
        </p>
      ) : null}

      {(tasksRes.data ?? []).length ? (
        <section className="mb-4 space-y-2">
          {(tasksRes.data ?? []).map((t) => (
            <div key={t.id} className={`surface p-3 text-sm ${t.priority === "high" ? "border-destructive/40" : ""}`}>
              <p className="font-medium">{t.title}</p>
              {t.details ? <p className="mt-1 text-xs text-muted-foreground">{t.details}</p> : null}
              <div className="mt-1 flex items-center justify-between gap-3">
                <p className="text-[11px] text-muted-foreground">
                  Open task, raised {formatDateTime(t.created_at)}. {closesTasks ? "Mark it done once it is dealt with." : "Finance or the transport coordinator closes it."}
                </p>
                {closesTasks ? (
                  <ActionForm action={closeTransportTask} label="Done" size="xs" variant="success">
                    <input type="hidden" name="bookingId" value={booking.id} />
                    <input type="hidden" name="taskId" value={t.id} />
                  </ActionForm>
                ) : null}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <section className="surface grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Parent">
          {booking.parent_first_name} {booking.parent_last_name}
        </Fact>
        <Fact label="Email">{booking.email}</Fact>
        <Fact label="Mobile">{booking.mobile ? prettyMobile(booking.mobile) : null}</Fact>
        <Fact label="Second contact">
          {booking.second_contact_name ? `${booking.second_contact_name}${booking.second_contact_mobile ? `, ${prettyMobile(booking.second_contact_mobile)}` : ""}` : null}
        </Fact>
        <Fact label="Pick-up address">{booking.address_line}</Fact>
        <Fact label="Area">
          {one(booking.transport_areas)?.name ?? "—"} ({one(booking.transport_zones)?.label ?? "—"})
        </Fact>
        <Fact label="Landmark">{booking.landmark}</Fact>
        <Fact label="Notes">{booking.notes}</Fact>
        <Fact label="Provider">{one(booking.transport_providers)?.name ?? null}</Fact>
        <Fact label="Terms agreed">
          Version {one(booking.transport_terms)?.version ?? "?"}, {formatDateTime(booking.terms_accepted_at)}
        </Fact>
        <Fact label="Paid">{booking.paid_at ? formatDateTime(booking.paid_at) : null}</Fact>
        {booking.cancelled_at ? (
          <Fact label="Cancelled">
            {formatDateTime(booking.cancelled_at)}
            {booking.cancel_reason ? `: ${booking.cancel_reason}` : ""}
          </Fact>
        ) : null}
      </section>

      <section className="mt-6 space-y-2">
        <h2 className="text-sm font-semibold">Children</h2>
        <div className="overflow-x-auto surface">
          <table className="data-table">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Child</th>
                <th className="px-3 py-2 font-medium">School</th>
                <th className="px-3 py-2 font-medium">Service and days</th>
                <th className="px-3 py-2 font-medium">Rate</th>
                <th className="px-3 py-2 text-right font-medium">Parent pays</th>
                {seesProvider ? <th className="px-3 py-2 text-right font-medium">Provider&rsquo;s share</th> : null}
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {riders.map((r) => {
                const charged = (r.transport_payout_items ?? []).some((i) => i.kind === "charge");
                const credited = (r.transport_payout_items ?? []).find((i) => i.kind === "credit");
                return (
                  <tr key={r.id}>
                    <td className="px-3 py-2">
                      <span className="font-medium">
                        {r.first_name} {r.last_name}
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground">{one(r.grades)?.name ?? ""}</span>
                    </td>
                    <td className="px-3 py-2 text-xs">{one(r.campuses)?.name ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      {SERVICE_LABELS[r.service]}
                      <br />
                      <span className="text-muted-foreground">{weekdaysLabel(r)}</span>
                    </td>
                    <td className="px-3 py-2 text-xs">{HOUSEHOLD_LABELS[r.household]}</td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums">{formatMoney(Number(r.amount_minor), "BWP")}</td>
                    {seesProvider ? (
                      <td className="px-3 py-2 text-right text-xs tabular-nums">
                        {formatMoney(shareOf(r), "BWP")}
                        <br />
                        <span className="text-muted-foreground">
                          {charged ? "paid" : r.status === "booked" ? "not paid yet" : "not owed: cancelled before the provider was paid"}
                          {credited ? `, credited ${formatMoney(Number(credited.amount_minor), "BWP")}` : ""}
                        </span>
                      </td>
                    ) : null}
                    <td className="px-3 py-2 text-xs">
                      {r.status === "booked" ? (
                        <Badge variant="success">Booked</Badge>
                      ) : (
                        <>
                          <Badge variant="muted">Cancelled</Badge>
                          <span className="ml-1 text-muted-foreground">
                            {formatDate(r.cancelled_at)}
                            {r.cancel_reason ? `: ${r.cancel_reason}` : ""}
                          </span>
                        </>
                      )}
                      {Number(r.refund_minor) > 0 ? (
                        <p className="mt-1 text-muted-foreground">
                          Refunded {formatMoney(Number(r.refund_minor), "BWP")}
                          {r.refunded_at ? ` (latest ${formatDate(r.refunded_at)}${r.refund_note ? `: ${r.refund_note}` : ""})` : ""}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="text-xs">
                <td className="px-3 py-2 font-medium" colSpan={4}>
                  Total
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(total, "BWP")}</td>
                {seesProvider ? <td className="px-3 py-2 text-right tabular-nums">{formatMoney(riders.reduce((s, r) => s + shareOf(r), 0), "BWP")}</td> : null}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">Each line was priced when the booking was made and is never re-priced.</p>
      </section>

      {canCancel && booked.length ? (
        <section className="mt-6 space-y-2">
          <h2 className="text-sm font-semibold">Cancel transport</h2>
          <ActionForm
            action={cancelTransportChildren}
            label={booking.status === "paid" ? "Cancel the ticked children" : "Cancel the booking"}
            variant="destructive"
            size="sm"
            className="surface space-y-3 p-4"
            confirm={
              booking.status === "paid"
                ? "Cancel transport for the ticked children? This cannot be undone. Finance is asked to decide the refund."
                : "Cancel this booking? This cannot be undone. The parent can make a new booking."
            }
          >
            <input type="hidden" name="bookingId" value={booking.id} />
            {booking.status === "paid" ? (
              <fieldset className="space-y-1 text-sm">
                <legend className="mb-1 text-xs text-muted-foreground">Which children</legend>
                {booked.map((r) => (
                  <label key={r.id} className="flex items-center gap-2">
                    <input type="checkbox" name="rider" value={r.id} /> {r.first_name} {r.last_name}, {one(r.campuses)?.name ?? "school"}
                  </label>
                ))}
              </fieldset>
            ) : (
              <>
                <input type="hidden" name="whole" value="1" />
                <p className="text-xs text-muted-foreground">This booking is not paid, so it is cancelled whole.</p>
              </>
            )}
            <Textarea name="reason" rows={2} required minLength={3} maxLength={500} placeholder="Why, in a few words. Kept on the booking; not sent to the parent." className="text-sm" aria-label="Reason" />
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" name="notify" value="1" defaultChecked /> Tell the parent by email
            </label>
          </ActionForm>
        </section>
      ) : null}

      {canRefund && riders.some((r) => r.status === "cancelled" && Number(r.refund_minor) < Number(r.amount_minor)) ? (
        <section className="mt-6 space-y-2">
          <h2 className="text-sm font-semibold">Record a refund</h2>
          <p className="text-xs text-muted-foreground">
            Make the refund first, in the payment gateway&rsquo;s portal or at the bank. This records what was refunded; it moves no money.
          </p>
          {riders
            .filter((r) => r.status === "cancelled" && Number(r.refund_minor) < Number(r.amount_minor))
            .map((r) => {
              const left = Number(r.amount_minor) - Number(r.refund_minor);
              return (
                <ActionForm
                  key={r.id}
                  action={recordTransportRefund}
                  label="Record refund"
                  size="sm"
                  variant="outline"
                  className="surface flex flex-wrap items-end gap-2 space-y-0 p-3"
                  confirm={`Record a refund for ${r.first_name} ${r.last_name}? Make sure the money has already been sent.`}
                >
                  <input type="hidden" name="bookingId" value={booking.id} />
                  <input type="hidden" name="riderId" value={r.id} />
                  <span className="w-full text-xs">
                    <span className="font-medium">
                      {r.first_name} {r.last_name}
                    </span>
                    : up to {formatMoney(left, "BWP")} is left to refund.
                  </span>
                  <label className="text-[11px] text-muted-foreground">
                    Amount (P)
                    <Input name="amount" placeholder={`up to ${(left / 100).toFixed(2)}`} required className="h-8 w-32 md:h-8" inputMode="decimal" />
                  </label>
                  <label className="grow text-[11px] text-muted-foreground">
                    How it was refunded
                    <Input name="note" required minLength={3} maxLength={500} placeholder="Gateway or bank reference" className="h-8 md:h-8" />
                  </label>
                </ActionForm>
              );
            })}
        </section>
      ) : null}

      {(requestsRes.data ?? []).length ? (
        <section className="mt-6 space-y-2">
          <h2 className="text-sm font-semibold">Payment</h2>
          <div className="surface divide-y divide-border text-xs">
            {(requestsRes.data ?? []).map((q) => (
              <p key={q.id} className="flex flex-wrap gap-3 p-3">
                <span className="font-medium">Request: {q.status.replace("_", " ")}</span>
                <span className="tabular-nums">
                  {formatMoney(Number(q.amount_minor), q.currency)}, received {formatMoney(Number(q.paid_minor), q.currency)}
                </span>
                <span className="text-muted-foreground">{q.paid_at ? `paid ${formatDateTime(q.paid_at)}` : `due ${formatDateTime(q.due_at)}`}</span>
              </p>
            ))}
            {(paymentsRes.data ?? []).map((p) => (
              <p key={p.id} className="flex flex-wrap gap-3 p-3">
                <span>
                  {p.method} via {p.provider}: {p.status}
                </span>
                <span className="tabular-nums">{formatMoney(Number(p.amount_minor), p.currency)}</span>
                <span className="text-muted-foreground">{formatDateTime(p.created_at)}</span>
                {p.failure_reason ? <span className="text-muted-foreground">{p.failure_reason}</span> : null}
              </p>
            ))}
          </div>
        </section>
      ) : null}

      {(emailsRes.data ?? []).length ? (
        <section className="mt-6 space-y-2">
          <h2 className="text-sm font-semibold">Emails to the parent</h2>
          <ul className="surface divide-y divide-border text-xs">
            {(emailsRes.data ?? []).map((m) => (
              <li key={m.id} className="flex flex-wrap gap-3 p-3">
                <span className="font-medium">{m.subject}</span>
                <span className="text-muted-foreground">
                  {m.status}, {formatDateTime(m.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
