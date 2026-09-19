import type { Metadata } from "next";
import { PageHeader } from "@/components/parent/page-header";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Stop marketing email" };
export const dynamic = "force-dynamic";

/**
 * The link at the foot of every marketing email. One visit, no button:
 * a parent who wanted to stop has stopped by the time the page renders.
 *
 * The token is random and never the contact's id, so a link cannot be
 * guessed from a record. The page runs under the service role, scoped to
 * that one token, and reveals nothing about who it belonged to. Service
 * email — a fee notice about their own child — is unaffected, and the page
 * says so.
 */
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const ctx = await requestContext();
  const verdict = await enforceRateLimit(admin, LIMITS.tokenResolve, ctx.ipHash ?? "unknown");

  let outcome: "done" | "unknown" | "busy" = "unknown";
  if (!verdict.ok) outcome = "busy";
  else if (/^[a-f0-9]{32}$/.test(token)) {
    const { data } = await admin
      .from("contacts")
      .update({ marketing_email_consent: false, unsubscribed_at: new Date().toISOString(), consent_source: "unsubscribe" })
      .eq("unsubscribe_token", token)
      .select("id, family_id")
      .maybeSingle();
    if (data) {
      outcome = "done";
      await admin.from("audit_log").insert({
        actor_type: "parent",
        actor_label: "Parent (via link)",
        action: "consent.unsubscribed",
        entity_type: "contact",
        entity_id: data.id,
        family_id: data.family_id,
        after: { marketing_email_consent: false },
        ip_hash: ctx.ipHash,
      });
    }
  }

  if (outcome === "busy") {
    return <PageHeader eyebrow="One moment" title="Please try again shortly." description="Too many requests arrived at once." />;
  }
  if (outcome === "unknown") {
    return (
      <PageHeader
        eyebrow="Marketing email"
        title="We could not find that link."
        description="It may have been copied incompletely. Open the email again and use the link at the bottom, or reply to it and ask us to stop."
      />
    );
  }
  return (
    <PageHeader
      eyebrow="Marketing email"
      title="You will not get marketing email from us."
      description="We will still write to you about your own child: fees, dates, and anything the school has to tell you. If you change your mind, tell anyone at the school and they can switch it back on."
    />
  );
}
