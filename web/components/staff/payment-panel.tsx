import { ActionForm } from "@/components/staff/action-form";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatDate, formatDateTime, hasStarted } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import type { PaymentRequestRow, PaymentRow } from "@/lib/supabase/types";
import { checkWithGateway, recordEft, recordRefund } from "@/app/staff/(console)/payments/actions";

/**
 * One application's payment position, and finance's actions on it. Used by
 * the Payments queue and the applicant's Payment tab so both say the same.
 */

const REQUEST_BADGE: Record<PaymentRequestRow["status"], "success" | "warning" | "destructive" | "info" | "secondary"> = {
  required: "warning",
  processing: "info",
  paid: "success",
  failed: "destructive",
  refunded: "secondary",
  partially_paid: "warning",
  cancelled: "secondary",
};

const PAYMENT_BADGE: Record<PaymentRow["status"], "success" | "warning" | "destructive" | "info" | "secondary"> = {
  pending: "secondary",
  processing: "info",
  succeeded: "success",
  failed: "destructive",
  expired: "secondary",
  refunded: "secondary",
};

export function PaymentPanel({
  applicationId,
  request,
  payments,
  canWrite,
  compact = false,
}: {
  applicationId: string;
  request: PaymentRequestRow;
  payments: PaymentRow[] | null;
  canWrite: boolean;
  compact?: boolean;
}) {
  const outstanding = Number(request.amount_minor) - Number(request.paid_minor);
  const open = ["required", "failed", "partially_paid", "processing"].includes(request.status);
  const overdue = open && hasStarted(request.due_at);
  const idField = <input type="hidden" name="applicationId" value={applicationId} />;

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={REQUEST_BADGE[request.status]}>{request.status.replace("_", " ")}</Badge>
        <span className="font-semibold tabular-nums">{formatMoney(Number(request.amount_minor), request.currency)}</span>
        {Number(request.paid_minor) > 0 && request.status !== "paid" ? <span className="text-xs text-muted-foreground">received {formatMoney(Number(request.paid_minor), request.currency)}, due {formatMoney(outstanding, request.currency)}</span> : null}
        <span className={`text-xs ${overdue ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
          {request.status === "paid" && request.paid_at ? `paid ${formatDate(request.paid_at)}` : `due ${formatDate(request.due_at)}${overdue ? " — overdue" : ""}`}
        </span>
      </div>

      {payments === null ? (
        <p className="text-xs text-muted-foreground">Receipts and attempts are visible to finance.</p>
      ) : payments.length ? (
        <ul className={`divide-y divide-border rounded-lg border border-border ${compact ? "text-xs" : ""}`}>
          {payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <Badge variant={PAYMENT_BADGE[p.status]}>{p.status}</Badge>
              <span className="tabular-nums">{formatMoney(Number(p.amount_minor), p.currency)}</span>
              <span className="text-muted-foreground">{p.method === "eft" ? `bank transfer · ref ${p.bank_reference ?? "—"}${p.received_on ? ` · received ${formatDate(p.received_on)}` : ""}` : `online · ${p.provider} · ${p.company_ref}`}</span>
              <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(p.updated_at)}</span>
              {p.failure_reason ? <span className="w-full text-xs text-destructive">{p.failure_reason}</span> : null}
              {p.note ? <span className="w-full text-xs text-muted-foreground">{p.note}</span> : null}
              {canWrite && p.status === "processing" ? (
                <ActionForm action={checkWithGateway} label="Check with gateway" size="xs" variant="outline">
                  {idField}<input type="hidden" name="paymentId" value={p.id} />
                </ActionForm>
              ) : null}
              {canWrite && p.status === "succeeded" ? (
                <ActionForm action={recordRefund} label="Record refund" size="xs" variant="ghost" className="flex items-center gap-2" confirm="Record that this payment was refunded? The money moves at the bank or gateway; this records it.">
                  {idField}<input type="hidden" name="paymentId" value={p.id} />
                  <Input name="note" placeholder="Why" className="h-7 w-40 md:h-7" required minLength={3} />
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No payments yet.</p>
      )}

      {canWrite && open && request.status !== "processing" ? (
        <ActionForm action={recordEft} label="Record bank transfer" size="sm" variant="outline" className="grid gap-2 rounded-lg border border-dashed border-border p-3 md:grid-cols-4">
          {idField}
          <Input name="amount" placeholder={`Amount (${request.currency})`} defaultValue={(outstanding / 100).toFixed(2)} inputMode="decimal" className="h-8 md:h-8" required />
          <Input name="receivedOn" type="date" className="h-8 md:h-8" required />
          <Input name="bankReference" placeholder="Bank reference" className="h-8 md:h-8" required minLength={2} />
          <Input name="note" placeholder="Note (optional)" className="h-8 md:h-8" />
        </ActionForm>
      ) : null}
    </div>
  );
}
