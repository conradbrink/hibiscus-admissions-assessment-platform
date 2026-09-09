"use server";

import { redirect } from "next/navigation";
import { acceptStaffInvite } from "@/lib/staff/invites";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type InviteState = { error?: string };

/**
 * Sets the password on an invitation and signs the person in. The token is
 * spent here, not when the page is opened, so a mail scanner that follows
 * the link cannot use up somebody's invitation.
 */
export async function acceptInvite(_: InviteState, formData: FormData): Promise<InviteState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (!token) return { error: "This invitation link is not recognised." };
  if (password !== confirm) return { error: "The two passwords do not match." };

  const admin = createAdminClient();
  const ctx = await requestContext();
  const verdict = await enforceRateLimit(admin, LIMITS.staffInvite, ctx.ipHash ?? "unknown");
  if (!verdict.ok) return { error: "Too many attempts from this computer. Try again in a few minutes." };

  const result = await acceptStaffInvite(admin, token, password);
  if (!result.ok) return { error: result.message };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: result.email, password });
  if (error) redirect("/staff/login?set=1");
  redirect("/staff");
}
