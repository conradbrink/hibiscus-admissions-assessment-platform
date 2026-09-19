"use server";

import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request";
import { createAdminClient } from "@/lib/supabase/admin";

export type UnsubscribeState = { done?: boolean; error?: string };

const TOKEN = /^[a-f0-9]{32}$/;

/**
 * The button on the unsubscribe page. The token is random and never the
 * contact's id, so a link cannot be guessed from a record; the action runs
 * under the service role, scoped to that one token, and reveals nothing
 * about who it belonged to.
 */
export async function confirmUnsubscribe(_prev: UnsubscribeState, formData: FormData): Promise<UnsubscribeState> {
  const token = String(formData.get("token") ?? "");
  if (!TOKEN.test(token)) return { error: "We could not find that link." };
  const admin = createAdminClient();
  const ctx = await requestContext();
  // Strict: the quota is this action's only guard, so a counter that cannot
  // count closes the door rather than opening it.
  const verdict = await enforceRateLimit(admin, LIMITS.tokenResolve, ctx.ipHash ?? "unknown", 1, { strict: true });
  if (!verdict.ok) return { error: "Too many requests arrived at once. Please try again shortly." };

  // The consent change and its audit line are one transaction in the
  // database, so neither can exist without the other.
  const { data: found, error } = await admin.rpc("crm_unsubscribe_email", { p_token: token, p_ip_hash: ctx.ipHash ?? null });
  if (error) return { error: "We could not save that. Please try again." };
  if (!found) return { error: "We could not find that link." };
  return { done: true };
}
