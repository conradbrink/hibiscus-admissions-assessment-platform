"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { handleReply } from "@/lib/messaging/inbound";
import { normaliseMobile } from "@/lib/contacts";
import { createAdminClient } from "@/lib/supabase/admin";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";

/**
 * Development only: a parent's WhatsApp reply, as the webhook would deliver
 * it, so the reply path (STOP, START, a question → task) can be walked
 * without a Meta account. Refuses in production: real replies come only
 * through the signed webhook.
 */
export async function simulateReply(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("admin");
    if (process.env.VERCEL_ENV === "production") throw new Error("Not available in production.");
    const p = z.object({ from: z.string().trim().min(7).max(25), text: z.string().trim().min(1).max(1000) }).parse(Object.fromEntries(formData));
    const from = normaliseMobile(p.from);
    if (!from) throw new Error("That number could not be normalised.");
    const outcome = await handleReply(createAdminClient(), from, p.text, `dev-in-${crypto.randomUUID()}`, new Date());
    if (outcome === "unknown") throw new Error("No contact has that mobile number.");
    void ctx;
    revalidatePath("/staff/admin/dev-outbox");
  });
}
