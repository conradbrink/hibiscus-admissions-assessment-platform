import type { Metadata } from "next";
import { PageHeader } from "@/components/parent/page-header";
import { UnsubscribeForm } from "@/components/parent/unsubscribe-form";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Stop marketing email" };
export const dynamic = "force-dynamic";

/**
 * The link at the foot of every marketing email. The visit shows a button
 * and changes nothing: mail scanners and link previews fetch a link before
 * the parent has read the email, and a fetch must not be a decision. The
 * button is `confirmUnsubscribe`, in actions.ts.
 *
 * The page only checks that the link is one we issued, under the service
 * role, scoped to that one token, and says nothing about who it is for.
 */
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let known = false;
  if (/^[a-f0-9]{32}$/.test(token)) {
    const { data } = await createAdminClient().from("contacts").select("id").eq("unsubscribe_token", token).maybeSingle();
    known = !!data;
  }
  if (!known) {
    return (
      <PageHeader
        eyebrow="Marketing email"
        title="We could not find that link."
        description="It may have been copied incompletely. Open the email again and use the link at the bottom, or reply to it and ask us to stop."
      />
    );
  }
  return <UnsubscribeForm token={token} />;
}
