import "server-only";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";
import { logoUrlFor } from "@/lib/documents/letterhead";
import { ReceiptDocument } from "@/lib/documents/receipt-pdf";
import { formatDateLong } from "@/lib/format-date";
import { requestLines } from "@/lib/payments/requests";
import { siteUrl } from "@/lib/tokens";
import type { SessionBooking } from "@/lib/transport/scope";

/**
 * A paid booking's receipt, as PDF bytes: the same document the admissions
 * and extras receipts use, with the booking's reference and its children.
 * Shared by the download route and the paid email, so the attachment and the
 * download are one document.
 */
export async function renderTransportReceipt(loaded: SessionBooking): Promise<{ filename: string; bytes: Uint8Array<ArrayBuffer> } | null> {
  const { booking, period, riders, request, payments } = loaded;
  const payment = payments.find((p) => p.status === "succeeded");
  if (!request || !payment) return null;

  const children = riders.filter((r) => r.status === "booked").map((r) => `${r.first_name} ${r.last_name}`).join(", ");
  const element = createElement(ReceiptDocument, {
    logoUrl: logoUrlFor(siteUrl()),
    letterhead: null,
    reference: booking.reference,
    referenceLabel: "Booking reference",
    receiptNumber: `R-${payment.id.slice(0, 8).toUpperCase()}`,
    studentName: children,
    forLine: `School transport${period ? `, ${period.label}` : ""}: ${children}`,
    payerName: `${booking.parent_first_name} ${booking.parent_last_name}`,
    campus: "",
    grade: "",
    currency: payment.currency,
    lines: requestLines(request),
    linesHeading: "School transport",
    amountMinor: Number(payment.amount_minor),
    method: payment.method,
    providerLabel: payment.provider === "dpo" ? "DPO Pay" : payment.provider === "paygate" ? "PayGate" : payment.provider,
    paymentReference: payment.company_ref,
    approvalCode: payment.approval_code,
    paidOn: formatDateLong(payment.updated_at),
    footText: "School transport · Generated from the payment record on the date shown.",
  }) as unknown as ReactElement<DocumentProps>;

  const buffer = await renderToBuffer(element);
  return { filename: `hibiscus-transport-receipt-${booking.reference}.pdf`, bytes: new Uint8Array(buffer) as Uint8Array<ArrayBuffer> };
}
