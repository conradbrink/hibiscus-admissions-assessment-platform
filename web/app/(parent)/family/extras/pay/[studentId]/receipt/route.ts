import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { redirect } from "next/navigation";
import { createElement, type ReactElement } from "react";
import { logoUrlFor } from "@/lib/documents/letterhead";
import { ReceiptDocument } from "@/lib/documents/receipt-pdf";
import { loadStudentReceipt } from "@/lib/family/extras";
import { familyClient } from "@/lib/family/scope";
import { formatDateLong } from "@/lib/format-date";
import { paymentReferenceFor } from "@/lib/payments/reference";
import { requestLines } from "@/lib/payments/requests";
import { siteUrl } from "@/lib/tokens";
import { requireFamilySession } from "@/lib/tokens/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The receipt for a paid extras order, rendered on demand from the payment row.
 *
 * The same document the admissions receipt uses, so a family gets one piece of
 * paper that looks like the school's: a family who has paid for a stationery
 * pack has as much right to a receipt as one who has paid a registration fee.
 * The reference is the child's name, which is what the office and the bank
 * statement will both recognise.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ studentId: string }> }): Promise<Response> {
  const { studentId } = await ctx.params;
  const session = await requireFamilySession();

  let receipt;
  try {
    receipt = await loadStudentReceipt(familyClient(), session, studentId);
  } catch {
    redirect("/family/extras");
  }
  if (!receipt) return new Response("Not found", { status: 404 });

  const { student, campus, gradeName, payerName, request, payment } = receipt;
  const reference = paymentReferenceFor(student.legal_first_name, student.legal_last_name);
  const paymentRef = payment.method === "eft" ? (payment.bank_reference ?? payment.company_ref) : payment.company_ref;

  const element = createElement(ReceiptDocument, {
    logoUrl: logoUrlFor(siteUrl()),
    letterhead: campus,
    reference,
    receiptNumber: `R-${payment.id.slice(0, 8).toUpperCase()}`,
    studentName: `${student.preferred_name || student.legal_first_name} ${student.legal_last_name}`,
    payerName,
    campus: campus?.name ?? "",
    grade: gradeName ?? "",
    currency: payment.currency,
    lines: requestLines(request),
    amountMinor: Number(payment.amount_minor),
    method: payment.method,
    providerLabel: payment.provider === "dpo" ? "DPO Pay" : payment.provider === "paygate" ? "PayGate" : payment.provider === "none" ? "" : payment.provider,
    paymentReference: paymentRef,
    approvalCode: payment.approval_code,
    paidOn: formatDateLong(payment.received_on ?? payment.updated_at),
  }) as unknown as ReactElement<DocumentProps>;

  const buffer = await renderToBuffer(element);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="hibiscus-extras-receipt-${student.student_code}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
