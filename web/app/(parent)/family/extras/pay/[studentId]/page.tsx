import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Download } from "lucide-react";
import { PageHeader } from "@/components/parent/page-header";
import { CheckPaymentButton, PayOnlineButton } from "@/components/parent/pay-buttons";
import { Button } from "@/components/ui/button";
import { earliestOrderBy, orderLines, outstandingTotal, type LabelledItem, type SelectionLike } from "@/lib/extras/catalogue";
import { loadStudentOrder } from "@/lib/family/extras";
import { familyClient } from "@/lib/family/scope";
import { formatDateLong } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import { paymentReferenceFor } from "@/lib/payments/reference";
import { requestLines } from "@/lib/payments/requests";
import { requireFamilySession } from "@/lib/tokens/server";
import { checkExtrasPayment, startExtrasPayment } from "./actions";

export const metadata: Metadata = { title: "Pay for the extras" };

/**
 * Paying for one child's order.
 *
 * Before a request exists the page shows what the order comes to, computed by
 * the same pure functions the extras page used, so a parent sees exactly what
 * they are about to be charged. Once they tap Pay, a request is raised and from
 * then on the figures are its — copied once and never recomputed, so the amount
 * cannot change under a parent who is mid-payment.
 *
 * One child per page, deliberately: siblings at campuses in different countries
 * are priced in different currencies, and one basket that cannot add up is
 * worse than two that do.
 */
export default async function ExtrasPayPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ cancelled?: string }>;
}) {
  const { studentId } = await params;
  const sp = await searchParams;
  const session = await requireFamilySession();

  let order;
  try {
    order = await loadStudentOrder(familyClient(), session, studentId);
  } catch {
    redirect("/family/extras");
  }

  const { student, request, payments, outstanding, items } = order;
  const name = student.preferred_name || student.legal_first_name;
  const reference = paymentReferenceFor(student.legal_first_name, student.legal_last_name);

  // Either the request's own copied lines, or — before one exists — the same
  // arithmetic over what is still unpaid.
  const basket = outstandingTotal(outstanding as unknown as SelectionLike[]);
  const lines = request
    ? requestLines(request)
    : orderLines(outstanding as unknown as SelectionLike[], items as unknown as LabelledItem[]);
  const currency = request?.currency ?? basket.currency;
  const totalMinor = request ? Number(request.amount_minor) : basket.totalMinor;
  const dueLabel = request ? request.due_at : earliestOrderBy(items);

  if (!lines.length || !currency) {
    // Nothing to pay for, or a basket that mixes two currencies and therefore
    // cannot be charged in one go. The extras page is where either belongs.
    redirect("/family/extras");
  }

  const paidMinor = request ? Number(request.paid_minor) : 0;
  const stillDue = totalMinor - paidMinor;
  const processing = payments.find((p) => p.status === "processing") ?? null;
  const lastFailed = payments.find((p) => p.status === "failed" || p.status === "expired") ?? null;
  const settled = request?.status === "paid";
  const canPay = !request || ["required", "failed", "partially_paid"].includes(request.status);

  return (
    <>
      <PageHeader
        eyebrow="Optional extras"
        title={name}
        description={`What you have ordered for ${name}${student.campus ? ` at ${student.campus.name}` : ""}.`}
      />

      {settled ? (
        <section className="rounded-2xl bg-success/10 p-5 text-sm">
          <p className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="size-4 text-success" aria-hidden /> Paid
            {request?.paid_at ? ` on ${formatDateLong(request.paid_at)}` : ""}
          </p>
          <p className="mt-1 text-muted-foreground">The office has the order. Nothing else is needed from you.</p>
          {payments.some((p) => p.status === "succeeded") ? (
            <div className="mt-4">
              <Button size="parent" variant="outline" nativeButton={false} render={<Link href={`/family/extras/pay/${student.id}/receipt`} prefetch={false} />}>
                <Download data-icon="inline-start" /> Download the receipt
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="mt-5 surface p-5 text-sm">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">The order ({currency})</p>
        <ul className="mt-2 divide-y divide-border">
          {lines.map((l) => (
            <li key={l.code} className="flex justify-between py-2">
              <span>{l.label}</span>
              <span className="tabular-nums">{formatMoney(l.amount_minor, currency)}</span>
            </li>
          ))}
          <li className="flex justify-between py-2 font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{formatMoney(totalMinor, currency)}</span>
          </li>
          {paidMinor > 0 && !settled ? (
            <>
              <li className="flex justify-between py-2">
                <span>Received so far</span>
                <span className="tabular-nums">{formatMoney(paidMinor, currency)}</span>
              </li>
              <li className="flex justify-between py-2 font-semibold">
                <span>Still due</span>
                <span className="tabular-nums">{formatMoney(stillDue, currency)}</span>
              </li>
            </>
          ) : null}
        </ul>
        {dueLabel && !settled ? (
          <p className="mt-3 text-xs text-muted-foreground">
            The school places its own order by {formatDateLong(dueLabel)}, so payment is needed before then.
          </p>
        ) : null}
      </section>

      {sp.cancelled ? (
        <p className="mt-4 text-sm text-muted-foreground">
          You came back without paying. Nothing has been charged, and the order is still here when you are ready.
        </p>
      ) : null}

      {lastFailed && !processing && !settled ? (
        <p className="mt-4 text-sm text-muted-foreground">
          The last attempt did not go through{lastFailed.failure_reason ? ` (${lastFailed.failure_reason})` : ""}. You can try again below.
        </p>
      ) : null}

      {processing ? (
        <section className="mt-5 surface p-5 text-sm">
          <p className="font-semibold">We are confirming your payment</p>
          <p className="mt-1 text-muted-foreground">
            This usually takes a moment. You can close this page — we will confirm it either way — or check now.
          </p>
          <div className="mt-4">
            <CheckPaymentButton action={checkExtrasPayment.bind(null, student.id)} />
          </div>
        </section>
      ) : canPay && stillDue > 0 ? (
        <section className="mt-5">
          <PayOnlineButton action={startExtrasPayment.bind(null, student.id)} label={`Pay ${formatMoney(stillDue, currency)}`} />
          <p className="mt-3 text-xs text-muted-foreground">
            You will be taken to the payment provider&rsquo;s own secure page. We never see or store your card details. If you would
            rather pay by transfer, use the reference <strong>{reference}</strong> and tell the office.
          </p>
        </section>
      ) : null}

      <div className="mt-6">
        <Button size="parent" variant="outline" nativeButton={false} render={<Link href="/family/extras" />}>
          Back to the extras
        </Button>
      </div>
    </>
  );
}
