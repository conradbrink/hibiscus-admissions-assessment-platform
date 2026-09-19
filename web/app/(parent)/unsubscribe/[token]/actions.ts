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
  const verdict = await enforceRateLimit(admin, LIMITS.tokenResolve, ctx.ipHash ?? "unknown");
  if (!verdict.ok) return { error: "Too many requests arrived at once. Please try again shortly." };

  const { data, error } = await admin
    .from("contacts")
    .update({ marketing_email_consent: false, unsubscribed_at: new Date().toISOString(), consent_source: "unsubscribe" })
    .eq("unsubscribe_token", token)
    .select("id, family_id")
    .maybeSingle();
  if (error) return { error: "We could not save that. Please try again." };
  if (!data) return { error: "We could not find that link." };
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
  return { done: true };
}
