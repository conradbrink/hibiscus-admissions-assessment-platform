import Link from "next/link";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { TransportPayoutLines } from "@/components/staff/transport-payout-lines";
import { Input } from "@/components/ui/input";
import { toSchoolDateString } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import { SERVICE_LABELS, weekdaysLabel } from "@/lib/transport/days";
import { chargeableRiders, chargeOf, creditableRiders } from "@/lib/transport/payout";
import { termPeriodIds } from "@/lib/transport/periods";
import { loadPeriods, loadProviders, loadStaffRiders } from "@/lib/transport/staff";
import { recordTransportPayout } from "../actions";

export const metadata = { title: "Record a transport payout" };
export const dynamic = "force-dynamic";

/**
 * What the provider is owed, as a form. Every child still booked on a paid
 * booking and not yet paid for is ticked; untick any the payment did not
 * cover. Cancelled children the provider was already paid for can take a
 * credit. The statement download is the same lines before anything is ticked
 * off, for checking against the provider's invoice.
 */
export default async function NewTransportPayoutPage({ searchParams }: { searchParams: Promise<{ term?: string; provider?: string }> }) {
  const sp = await searchParams;
  const { supabase, permissions } = await requireStaff("transport.finance");
  const [periods, providers] = await Promise.all([loadPeriods(supabase), loadProviders(supabase)]);
  const terms = periods.filter((p) => p.kind === "term");
  const term = terms.find((t) => t.id === sp.term) ?? null;
  const active = providers.filter((p) => p.is_active);
  const provider = providers.find((p) => p.id === sp.provider) ?? active[0] ?? providers[0] ?? null;
  const riders = await loadStaffRiders(supabase, { paidOnly: true, ...(term ? { periodIds: termPeriodIds(periods, term.id) } : {}) });
  const label = new Map(periods.map((p) => [p.id, p.label]));
  const charges = provider ? chargeableRiders(riders, provider.id) : [];
  const credits = provider ? creditableRiders(riders, provider.id) : [];
  const canRecord = can(permissions, "finance.write");
  const statement = `/staff/transport/payouts/statement?${new URLSearchParams({ ...(term ? { term: term.id } : {}), ...(provider ? { provider: provider.id } : {}) })}`;

  return (
    <>
      <PageTitle
        back={{ href: "/staff/transport/payouts", label: "Transport payouts" }}
        title="Record a payment to the provider"
        description="Pay at the bank first. Then tick the children the payment covers, add any credits, and record it with the bank's reference. A recorded payment cannot be changed."
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Term</span>
          <select name="term" defaultValue={term?.id ?? ""} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
            <option value="">Every term</option>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {providers.length > 1 ? (
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">Provider</span>
            <select name="provider" defaultValue={provider?.id ?? ""} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="submit" className="h-9 rounded-md border border-border px-3 text-sm">
          Show
        </button>
        {charges.length ? (
          <Link href={statement} prefetch={false} className="h-9 px-2 text-sm leading-9 font-medium text-primary underline underline-offset-2">
            Download what is owed (Excel)
          </Link>
        ) : null}
      </form>

      {!provider ? (
        <p className="text-sm text-muted-foreground">No transport provider is set up.</p>
      ) : !charges.length ? (
        <p className="surface p-4 text-sm text-muted-foreground">
          Nothing is owed to {provider.name}
          {term ? ` for ${term.label}` : ""}. Every child booked and paid for by a parent has been paid for.
          {credits.length ? " Credits for cancelled children can be taken on the next payment that has children to pay for." : ""}
        </p>
      ) : !canRecord ? (
        <p className="surface p-4 text-sm text-muted-foreground">
          {charges.length} {charges.length === 1 ? "child is" : "children are"} owed for. Recording a payment needs permission to record payments.
        </p>
      ) : (
        <ActionForm
          action={recordTransportPayout}
          label="Record the payment"
          resetOnSubmit={false}
          className="space-y-4"
          confirm={`Record this payment to ${provider.name}? A recorded payment cannot be changed.`}
        >
          <input type="hidden" name="providerId" value={provider.id} />
          <TransportPayoutLines
            charges={charges.map((r) => ({
              id: r.id,
              label: `${r.firstName} ${r.lastName}, ${r.school}`,
              detail: `${r.reference} · ${label.get(r.booking.periodId) ?? ""} · ${SERVICE_LABELS[r.service]}, ${weekdaysLabel(r.days)}`,
              amountMinor: r.providerAmountMinor,
            }))}
            credits={credits.map((r) => ({
              id: r.id,
              label: `${r.firstName} ${r.lastName}, ${r.school}`,
              detail: `${r.reference} · ${label.get(r.booking.periodId) ?? ""}`,
              maxMinor: chargeOf(r),
              refundedMinor: r.refundMinor,
            }))}
          />
          <div className="surface grid gap-3 p-4 sm:grid-cols-[160px_1fr]">
            <label className="text-xs text-muted-foreground">
              Paid on
              <Input type="date" name="paidOn" required defaultValue={toSchoolDateString(new Date())} max={toSchoolDateString(new Date())} className="h-9" />
            </label>
            <label className="text-xs text-muted-foreground">
              Bank reference
              <Input name="bankReference" required maxLength={120} placeholder="The reference on the bank's confirmation" className="h-9" />
            </label>
            <label className="text-xs text-muted-foreground sm:col-span-2">
              Note (optional)
              <Input name="note" maxLength={1000} placeholder="Anything finance will want to know later" className="h-9" />
            </label>
          </div>
        </ActionForm>
      )}
    </>
  );
}
