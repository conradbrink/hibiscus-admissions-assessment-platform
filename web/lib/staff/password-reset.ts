import "server-only";
import { sendStaffEmail } from "@/lib/email/send";
import { mintStaffInvite } from "@/lib/staff/invites";
import type { AdminClient } from "@/lib/supabase/admin";

/** A reset link is good for this long. Long enough to find the email; short enough that a stale inbox is not a door. */
const RESET_LINK_TTL_MS = 60 * 60_000;

/**
 * "Forgotten your password?", answered by us.
 *
 * Finds the active member of staff behind the address, mints a reset link on
 * the invitation table (revoking any unused invitation or earlier reset, so
 * one email is ever live) and sends it through our own template and mailer —
 * the same path invitations take, which delivers. The caller says the same
 * thing to the person whatever this returns; an address that is not on the
 * staff list is never confirmed as such from the sign-in page.
 */
export async function requestStaffPasswordReset(admin: AdminClient, email: string): Promise<"sent" | "unknown"> {
  const { data: profile } = await admin
    .from("staff_profiles")
    .select("id, full_name, email, is_active")
    // Addresses are stored as typed; the person typing theirs later may not
    // match the case. `%` and `_` are escaped so the form cannot wildcard.
    .ilike("email", email.replace(/[\\%_]/g, (c) => `\\${c}`))
    .maybeSingle();
  if (!profile || !profile.is_active) return "unknown";

  const { id, url } = await mintStaffInvite(admin, profile.id, null, {
    purpose: "reset",
    expiresAt: new Date(Date.now() + RESET_LINK_TTL_MS),
  });
  const result = await sendStaffEmail(admin, {
    staffId: profile.id,
    templateKey: "staff_password_reset",
    variables: {
      staff_first_name: profile.full_name.split(" ")[0] || "there",
      reset_link: url,
      console_link: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/staff`,
    },
    idempotencyKey: `staff_password_reset:${id}`,
  });
  if (result.status === "failed") throw new Error(`reset email did not send: ${result.error}`);

  await admin.from("audit_log").insert({
    actor_type: "system",
    actor_label: "Forgot password (sign-in page)",
    action: "staff.password_reset_requested",
    entity_type: "staff_profile",
    entity_id: profile.id,
    after: { email: profile.email },
  });
  return "sent";
}
