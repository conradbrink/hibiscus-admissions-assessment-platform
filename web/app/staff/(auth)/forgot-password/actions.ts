"use server";

import { after } from "next/server";
import { z } from "zod";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request";
import { requestStaffPasswordReset } from "@/lib/staff/password-reset";
import { createAdminClient } from "@/lib/supabase/admin";

export type ForgotPasswordState = { done?: boolean; error?: string };

/**
 * Sends a reset link, or does not, and says the same thing either way. The
 * two rate limits are different questions: one computer asking often, and
 * one address being asked for often — the second is how a stranger with a
 * colleague's email would fill their inbox.
 */
export async function requestPasswordReset(_: ForgotPasswordState, formData: FormData): Promise<ForgotPasswordState> {
  const parsed = z.email().safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  if (!parsed.success) return { error: "Enter your email address." };
  const email = parsed.data;

  const admin = createAdminClient();
  const ctx = await requestContext();
  const byIp = await enforceRateLimit(admin, LIMITS.staffResetByIp, ctx.ipHash ?? "unknown");
  if (!byIp.ok) return { error: "Too many requests from this computer. Try again in a few minutes." };
  const byEmail = await enforceRateLimit(admin, LIMITS.staffResetByEmail, email);
  if (!byEmail.ok) return { done: true };

  // After the response, not before it: minting a link and sending an email
  // takes hundreds of milliseconds and an unknown address takes one query,
  // and the difference would say from the sign-in page which addresses are
  // on the staff list. The answer on the screen is the same either way, and
  // now so is how long it takes to arrive. Failures are logged, not shown:
  // the person cannot act on them.
  after(async () => {
    try {
      await requestStaffPasswordReset(admin, email);
    } catch (e) {
      console.error("[staff] password reset failed", e);
    }
  });
  return { done: true };
}
