import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { redirect } from "next/navigation";
import { createElement, type ReactElement } from "react";
import { loadApplicationGraph } from "@/lib/applications";
import { ReceiptDocument } from "@/lib/documents/receipt-pdf";
import { formatDateLong } from "@/lib/format-date";
import { loadLatestPaymentRequest, requestLines } from "@/lib/payments/requests";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireParentSession } from "@/lib/tokens/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The receipt for the latest successful payment, rendered on demand from the payment row. */
export async function GET(): Promise<Response> {
  const session = await requireParentSession();
  const admin = createAdminClient();
  const graph = await loadApplicationGraph(admin, session.applicationId);
  if (!graph) redirect("/link?reason=unknown");
  const request = await loadLatestPaymentRequest(admin, graph.application.id);
  if (!request) return new Response("Not found", { status: 404 });
  const { data: payment } = await admin
    .from("payments")
    .select("*")
    .eq("payment_request_id", request.id)
    .eq("status", "succeeded")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!payment) return new Response("Not found", { status: 404 });

  const reference = payment.method === "eft" ? (payment.bank_reference ?? payment.company_ref) : payment.company_ref;
  const element = createElement(ReceiptDocument, {
    reference: graph.application.reference,
    receiptNumber: `R-${payment.id.slice(0, 8).toUpperCase()}`,
    studentName: `${graph.application.child_first_name} ${graph.application.child_last_name}`,
    payerName: `${graph.contact.first_name} ${graph.contact.last_name}`,
    campus: graph.campus.name,
    grade: graph.grade.name,
    currency: payment.currency,
    lines: requestLines(request),
    amountMinor: Number(payment.amount_minor),
    method: payment.method,
    providerLabel: payment.provider === "dpo" ? "DPO Pay" : payment.provider,
    paymentReference: reference,
    approvalCode: payment.approval_code,
    paidOn: formatDateLong(payment.received_on ?? payment.updated_at),
  }) as unknown as ReactElement<DocumentProps>;
  const buffer = await renderToBuffer(element);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="hibiscus-receipt-${graph.application.reference}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
