import { ChoosePassword } from "@/components/staff/choose-password";
import { findStaffInvite } from "@/lib/staff/invites";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Where an invited member of staff chooses their password. Opening this page
 * reads the invitation but does not spend it, so a link scanner cannot use
 * it up before the person clicks.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const lookup = await findStaffInvite(createAdminClient(), token);
  return <ChoosePassword token={token} lookup={lookup} purpose="invite" />;
}
