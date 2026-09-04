"use server";

import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normaliseEmail } from "@/lib/contacts";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request";
import { fieldErrors, freshLinkSchema } from "@/lib/validation";
import { drainJobs } from "@/lib/workflow/jobs";

export type FreshLinkState = {
  done?: boolean;
  fields?: Record<string, string>;
  error?: string;
};

/**
 * "Send me a new link." Responds identically whether or not the email and
 * reference match an application, so it cannot be used to discover which
 * references exist or which email a family used. The email itself is sent
 * as a job, from the drain, only when there was a match.
 */
export async function requestFreshLink(_prev: FreshLinkState, formData: FormData): Promise<FreshLinkState> {
  const parsed = freshLinkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fields: fieldErrors(parsed.error) };

  const admin = createAdminClient();
  const ctx = await requestContext();
  const email = normaliseEmail(parsed.data.email);
  const [byIp, byEmail] = await Promise.all([
    enforceRateLimit(admin, LIMITS.freshLinkByIp, ctx.ipHash ?? "unknown"),
    enforceRateLimit(admin, LIMITS.freshLinkByEmail, email),
  ]);
  if (!byIp.ok || !byEmail.ok) {
    // Still "done": a limit message here would itself be a signal.
    return { done: true };
  }

  const { data: app } = await admin
    .from("applications")
    .select("id, status, contacts!inner(email_normalised)")
    .eq("reference", parsed.data.reference)
    .eq("contacts.email_normalised", email)
    .neq("status", "withdrawn")
    .maybeSingle();

  if (app) {
    await admin.from("jobs").upsert(
      {
        type: "send_email",
        payload: { template_key: "fresh_link" },
        application_id: app.id,
        // One fresh-link email per application per minute, however many
        // times the button is pressed.
        idempotency_key: `email:${app.id}:fresh_link:${Math.floor(Date.now() / 60_000)}`,
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true }
    );
    after(async () => {
      await drainJobs(createAdminClient()).catch((e) => console.error("[jobs] drain failed", e));
    });
  }

  return { done: true };
}
