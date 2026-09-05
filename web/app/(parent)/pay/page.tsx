import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Download } from "lucide-react";
import { PageHeader } from "@/components/parent/page-header";
import { CheckPaymentButton, PayOnlineButton } from "@/components/parent/pay-buttons";
import { Button } from "@/components/ui/button";
import { loadApplicationGraph } from "@/lib/applications";
import { formatDateLong } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import { loadBankInstructions, loadLatestPaymentRequest, requestLines } from "@/lib/payments/requests";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireParentSession } from "@/lib/tokens/server";
import { checkPayment, startOnlinePayment } from "./actions";

export const metadata: Metadata = { title: "Pay the fees" };

/**
 * What is owed, and the two ways to pay it. The figures are the payment
 * request's, copied from the accepted offer; the page never computes money.
 */
export default async function PayPage({ searchParams }: { searchParams: Promise<{ cancelled?: string }> }) {
  const sp = await searchParams;
  const session = await requireParentSession();
  const admin = createAdminClient();
  const graph = await loadApplicationGraph(admin, session.applicationId);
  if (!graph) redirect("/link?reason=unknown");
  const app = graph.application;
  const request = await loadLatestPaymentRequest(admin, app.id);
  if (!request) redirect("/next");

  const [{ data: payments }, bank] = await Promise.all([
    admin.from("payments").select("*").eq("payment_request_id", request.id).order("created_at", { ascending: false }),
    loadBankInstructions(admin, { currency: request.currency, campusId: app.campus_id }),
  ]);
  const lines = requestLines(request);
  const outstanding = Number(request.amount_minor) - Number(request.paid_minor);
  const processing = (payments ?? []).find((p) => p.status === "processing") ?? null;
  const succeeded = (payments ?? []).filter((p) => p.status === "succeeded");
  const lastFailed = (payments ?? []).find((p) => p.status === "failed" || p.status === "expired") ?? null;
  const settled = request.status === "paid";
  const canPay = app.status === "payment_required" && ["required", "failed", "partially_paid"].includes(request.status);

  return (
    <>
      <PageHeader
        eyebrow="Registration & admission fees"
        title={`${app.child_first_name} ${app.child_last_name}`}
        description={`${graph.grade.name} at ${graph.campus.name}, starting ${graph.intake.label}. Reference ${app.reference}.`}
      />

      {settled ? (
        <section className="rounded-2xl bg-success/10 p-5 text-sm">
          <p className="flex items-center gap-2 font-semibold"><CheckCircle2 className="size-4 text-success" aria-hidden /> Paid in full{request.paid_at ? ` on ${formatDateLong(request.paid_at)}` : ""}</p>
          <p className="mt-1 text-muted-foreground">{app.child_first_name}&rsquo;s place is secured. The last step is registration.</p>
          <div className="mt-4 flex flex-col gap-2">
            {app.status === "registration_incomplete" ? (
              <Button size="parent" nativeButton={false} render={<Link href="/register" />}>Complete registration</Button>
            ) : null}
            {succeeded.length ? (
              <Button size="parent" variant="outline" nativeButton={false} render={<Link href="/pay/receipt" prefetch={false} />}>
                <Download data-icon="inline-start" /> Download the receipt
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="mt-5 rounded-2xl border border-border bg-card p-5 text-sm">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Fees payable on acceptance ({request.currency})</p>
        <ul className="mt-2 divide-y divide-border">
          {lines.map((l) => (
            <li key={l.code} className="flex justify-between py-2"><span>{l.label}</span><span className="tabular-nums">{formatMoney(l.amount_minor, request.currency)}</span></li>
          ))}
          <li className="flex justify-between py-2 font-semibold"><span>Total</span><span className="tabular-nums">{formatMoney(Number(request.amount_minor), request.currency)}</span></li>
          {Number(request.paid_minor) > 0 && !settled ? (
            <>
              <li className="flex justify-between py-2"><span>Received so far</span><span className="tabular-nums">{formatMoney(Number(request.paid_minor), request.currency)}</span></li>
              <li className="flex justify-between py-2 font-semibold"><span>Still due</span><span className="tabular-nums">{formatMoney(outstanding, request.currency)}</span></li>
            </>
          ) : null}
        </ul>
        {!settled ? <p className="mt-2 text-xs text-muted-foreground">Due by {formatDateLong(request.due_at)}.</p> : null}
      </section>

      {processing && !settled ? (
        <section className="mt-5 rounded-2xl border-2 border-primary bg-card p-5 text-sm">
          <p className="font-semibold">We are confirming your payment</p>
          <p className="mt-1 text-muted-foreground">
            A payment started {formatDateLong(processing.created_at)} is being confirmed with the payment provider. This usually takes a minute; we will email a receipt as soon as it is confirmed. If you did not complete it, you can check again and then pay.
          </p>
          <div className="mt-4"><CheckPaymentButton action={checkPayment} /></div>
        </section>
      ) : null}

      {sp.cancelled && !processing && !settled ? (
        <p className="mt-5 rounded-2xl bg-warning/20 p-4 text-sm">The payment was cancelled before it completed. Nothing has been charged. You can try again below.</p>
      ) : null}
      {lastFailed && !processing && !settled && !sp.cancelled ? (
        <p className="mt-5 rounded-2xl bg-warning/20 p-4 text-sm">The last online payment was not completed{lastFailed.failure_reason === "expired" ? " in time" : ""}. Nothing has been charged. You can try again below.</p>
      ) : null}

      {canPay && !processing ? (
        <section className="mt-5 space-y-4">
          <div className="rounded-2xl border-2 border-primary bg-card p-5">
            <p className="text-xs font-semibold tracking-wide text-primary uppercase">Pay online</p>
            <p className="mt-1 text-sm text-muted-foreground">Card or instant EFT on our payment provider&rsquo;s secure page. We never see your card details.</p>
            <div className="mt-4"><PayOnlineButton action={startOnlinePayment} label={`Pay ${formatMoney(outstanding, request.currency)} securely online`} /></div>
          </div>
          {bank ? (
            <details className="rounded-2xl border border-border bg-card p-5 text-sm">
              <summary className="cursor-pointer font-semibold">Pay by bank transfer instead</summary>
              <p className="mt-2 whitespace-pre-line">{bank.body_text}</p>
              <p className="mt-3">Please use the reference <strong>{app.reference}</strong> so we can match your payment. We will email a receipt once it reaches us; this can take a working day or two.</p>
            </details>
          ) : null}
        </section>
      ) : null}

      <p className="mt-6 text-sm"><Link href="/offer" className="font-medium text-primary underline underline-offset-2">View the offer</Link> · <Link href="/next" className="font-medium text-primary underline underline-offset-2">Back to your application</Link></p>
    </>
  );
}
