import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { redirect } from "next/navigation";
import { createElement, type ReactElement } from "react";
import { loadApplicationGraph } from "@/lib/applications";
import { OfferDocument } from "@/lib/documents/offer-pdf";
import { logoUrlFor } from "@/lib/documents/letterhead";
import { formatDateLong } from "@/lib/format-date";
import { loadVisibleOffer } from "@/lib/offers/load";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/tokens";
import { requireParentSession } from "@/lib/tokens/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const session = await requireParentSession();
  const admin = createAdminClient();
  const graph = await loadApplicationGraph(admin, session.applicationId);
  if (!graph) redirect("/link?reason=unknown");
  const offer = await loadVisibleOffer(admin, graph.application.id);
  if (!offer) return new Response("Not found", { status: 404 });

  const element = createElement(OfferDocument, {
    logoUrl: logoUrlFor(siteUrl()),
    letterhead: graph.campus,
    studentName: `${graph.application.child_first_name} ${graph.application.child_last_name}`,
    reference: graph.application.reference,
    bodyHtml: offer.rendered_html,
    termsHtml: offer.terms_html,
    fees: offer.feeSnapshot,
    bankDetails: typeof (offer.variables as { bank_details?: unknown })?.bank_details === "string" ? ((offer.variables as { bank_details: string }).bank_details ?? null) : null,
    expiresOn: offer.expires_at ? formatDateLong(offer.expires_at) : null,
    sentOn: offer.sent_at ? formatDateLong(offer.sent_at) : null,
  }) as unknown as ReactElement<DocumentProps>;
  const buffer = await renderToBuffer(element);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="hibiscus-offer-${graph.application.reference}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
