import "server-only";
import { randomBytes } from "node:crypto";
import { hashToken, siteUrl } from "@/lib/tokens";
import type { AdminClient } from "@/lib/supabase/admin";

/**
 * Invitation and password-reset links for the staff console.
 *
 * Supabase's own invite email carries a token that lasts a day and is spent
 * by the first request to reach it — including the link scanners a school
 * mail system runs before the person clicks. That is why invitations read
 * "expired" on the first click. These links are ours: they do not expire,
 * they are spent only when the password is actually set, and sending a new
 * one revokes the old.
 *
 * A password reset is the same link with a different purpose, sent through
 * the same templates and mailer as an invitation, so the office can see in
 * the email log that it went and to which address — Supabase's own recovery
 * email leaves no trace on our side, and "no email ever arrived" was
 * undiagnosable. It differs from an invitation only in what the page says
 * and in lapsing after an hour.
 *
 * Only the hash is stored. The raw token lives in the email and nowhere else.
 */

const TOKEN_BYTES = 32;
const MIN_PASSWORD = 12;

export type InvitePurpose = "invite" | "reset";

export function inviteLink(token: string): string {
  return `${siteUrl()}/staff/invite/${token}`;
}

export function resetLink(token: string): string {
  return `${siteUrl()}/staff/reset-password/${token}`;
}

/**
 * Mints a fresh link and revokes every earlier live one for that person —
 * invitation or reset alike — so an old email in an inbox stops working the
 * moment a new one is sent. One live link per person is the whole model:
 * whichever email they open last is the one that works.
 */
export async function mintStaffInvite(
  admin: AdminClient,
  staffId: string,
  createdBy: string | null,
  opts: { purpose?: InvitePurpose; expiresAt?: Date | null } = {}
): Promise<{ id: string; token: string; url: string }> {
  const purpose = opts.purpose ?? "invite";
  await admin
    .from("staff_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("staff_id", staffId)
    .is("accepted_at", null)
    .is("revoked_at", null);

  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const { data, error } = await admin
    .from("staff_invites")
    .insert({
      staff_id: staffId,
      token_hash: hashToken(token),
      created_by: createdBy,
      purpose,
      expires_at: opts.expiresAt ? opts.expiresAt.toISOString() : null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "could not mint the link");
  return { id: data.id, token, url: purpose === "reset" ? resetLink(token) : inviteLink(token) };
}

export type InviteLookup =
  | { ok: true; staffId: string; fullName: string; email: string; purpose: InvitePurpose }
  | { ok: false; reason: "unknown" | "accepted" | "revoked" | "expired" | "inactive" };

/**
 * Reads an invitation without spending it, so opening the page twice — or a
 * scanner opening it first — costs nothing.
 */
export async function findStaffInvite(admin: AdminClient, token: string): Promise<InviteLookup> {
  const { data } = await admin
    .from("staff_invites")
    .select("id, staff_id, accepted_at, revoked_at, expires_at, purpose, staff_profiles(full_name, email, is_active)")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!data) return { ok: false, reason: "unknown" };
  if (data.accepted_at) return { ok: false, reason: "accepted" };
  if (data.revoked_at) return { ok: false, reason: "revoked" };
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return { ok: false, reason: "expired" };
  const profile = Array.isArray(data.staff_profiles) ? data.staff_profiles[0] : data.staff_profiles;
  if (!profile || !profile.is_active) return { ok: false, reason: "inactive" };
  return { ok: true, staffId: data.staff_id, fullName: profile.full_name, email: profile.email, purpose: data.purpose };
}

export type AcceptResult = { ok: true; email: string } | { ok: false; message: string };

/**
 * Sets the password and spends the invitation, in that order, under a
 * conditional update so two simultaneous submissions cannot both win.
 */
export async function acceptStaffInvite(admin: AdminClient, token: string, password: string): Promise<AcceptResult> {
  if (password.length < MIN_PASSWORD) return { ok: false, message: `Use at least ${MIN_PASSWORD} characters.` };
  const found = await findStaffInvite(admin, token);
  if (!found.ok) return { ok: false, message: reasonText(found.reason) };

  const { data: spent, error: spendErr } = await admin
    .from("staff_invites")
    .update({ accepted_at: new Date().toISOString() })
    .eq("token_hash", hashToken(token))
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (spendErr) return { ok: false, message: spendErr.message };
  if (!spent) return { ok: false, message: reasonText("accepted") };

  const { error } = await admin.auth.admin.updateUserById(found.staffId, { password, email_confirm: true });
  if (error) {
    // Give the invitation back rather than stranding the person.
    await admin.from("staff_invites").update({ accepted_at: null }).eq("id", spent.id);
    return { ok: false, message: "Could not set the password. Try again, or ask for a new invitation." };
  }
  return { ok: true, email: found.email };
}

export function reasonText(reason: Exclude<InviteLookup, { ok: true }>["reason"], purpose: InvitePurpose = "invite"): string {
  if (purpose === "reset") {
    switch (reason) {
      case "accepted":
        return "This reset link has already been used. Sign in with your new password, or ask for another link.";
      case "revoked":
        return "A newer link has been sent to you. Please use the most recent email.";
      case "expired":
        return "This reset link has lapsed — they last an hour. Ask for a new one from the sign-in page.";
      case "inactive":
        return "This account cannot sign in at the moment. Ask the office to check it.";
      default:
        return "This link is not recognised. Check that you copied the whole link, or ask for a new one from the sign-in page.";
    }
  }
  switch (reason) {
    case "accepted":
      return "This invitation has already been used. Sign in with your password, or use “Forgotten your password?” on the sign-in page.";
    case "revoked":
      return "A newer invitation has been sent to you. Please use the most recent email.";
    case "expired":
      return "This invitation has lapsed. Ask the office to send a new one.";
    case "inactive":
      return "This account cannot sign in at the moment. Ask the office to check it.";
    default:
      return "This invitation link is not recognised. Check that you copied the whole link, or ask for a new one.";
  }
}
