import { ChoosePassword } from "@/components/staff/choose-password";
import { findStaffInvite } from "@/lib/staff/invites";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Where a reset link lands. The same form as an invitation: the link is read
 * without being spent, the password is set through the service role when the
 * form is submitted, and the person is signed in.
 */
export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const lookup = await findStaffInvite(createAdminClient(), token);
  return <ChoosePassword token={token} lookup={lookup} purpose="reset" />;
}
