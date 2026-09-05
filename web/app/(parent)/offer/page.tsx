import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/parent/page-header";
import { Button } from "@/components/ui/button";
import { loadApplicationGraph } from "@/lib/applications";
import { formatDateLong } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import { loadVisibleOffer } from "@/lib/offers/load";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireParentSession } from "@/lib/tokens/server";
import { onOfferViewed } from "@/lib/workflow/offer-actions";

export const metadata: Metadata = { title: "Your offer" };

/**
 * The offer as sent: the snapshot, not a fresh render. Acceptance and
 * payment arrive with Phase 3; until then the page says how to accept.
 */
export default async function OfferPage() {
  const session = await requireParentSession();
  const admin = createAdminClient();
  const graph = await loadApplicationGraph(admin, session.applicationId);
  if (!graph) redirect("/link?reason=unknown");
  const offer = await loadVisibleOffer(admin, graph.application.id);
  if (!offer) notFound();
  await onOfferViewed(admin, graph.application, offer);

  const expired = offer.status === "expired";
  const fees = offer.feeSnapshot;

  return (
    <>
      <PageHeader
        eyebrow="Offer of admission"
        title={`${graph.application.child_first_name} ${graph.application.child_last_name}`}
        description={`${graph.grade.name} at ${graph.campus.name}, starting ${graph.intake.label}.`}
      />

      {expired ? (
        <p className="mb-4 rounded-2xl bg-warning/20 p-4 text-sm">This offer expired on {offer.expires_at ? formatDateLong(offer.expires_at) : "its closing date"}. If you would still like the place, please reply to the email or contact admissions.</p>
      ) : offer.expires_at ? (
        <p className="mb-4 rounded-2xl border-2 border-primary bg-card p-4 text-sm"><span className="font-semibold">Open until {formatDateLong(offer.expires_at)}.</span></p>
      ) : null}

      <article className="prose prose-sm max-w-none rounded-2xl border border-border bg-card p-5" dangerouslySetInnerHTML={{ __html: offer.rendered_html }} />

      {fees ? (
        <section className="mt-5 rounded-2xl border border-border bg-card p-5 text-sm">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Fees ({fees.currency})</p>
          <ul className="mt-2 divide-y divide-border">
            {fees.lines.map((l) => (
              <li key={l.code} className="flex justify-between py-2"><span>{l.label}</span><span className="tabular-nums">{formatMoney(l.amount_minor, fees.currency)}</span></li>
            ))}
            <li className="flex justify-between py-2 font-semibold"><span>Payable on acceptance</span><span className="tabular-nums">{formatMoney(fees.payable_at_acceptance_minor, fees.currency)}</span></li>
          </ul>
        </section>
      ) : null}

      <details className="mt-5 rounded-2xl border border-border bg-card p-5 text-sm">
        <summary className="cursor-pointer font-semibold">Terms</summary>
        <div className="prose prose-sm mt-2 max-w-none" dangerouslySetInnerHTML={{ __html: offer.terms_html }} />
      </details>

      {!expired ? (
        <section className="mt-6 rounded-2xl bg-primary/10 p-5 text-sm">
          <p className="font-semibold">How to accept</p>
          <p className="mt-1 text-muted-foreground">Online acceptance and payment are coming soon. For now, reply to the email this link came in, or contact the admissions office, and we will confirm the place and send payment details.</p>
        </section>
      ) : null}

      <div className="mt-6">
        <Button size="parent" variant="outline" nativeButton={false} render={<Link href="/offer/pdf" prefetch={false} />}>
          <Download data-icon="inline-start" /> Download the offer as PDF
        </Button>
      </div>
      <p className="mt-4 text-sm"><Link href="/profile" className="font-medium text-primary underline underline-offset-2">View the learning profile</Link> · <Link href="/next" className="font-medium text-primary underline underline-offset-2">Back to your application</Link></p>
    </>
  );
}
