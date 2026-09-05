import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { onEnquiryCreated } from "@/lib/workflow/actions";
import { SYSTEM_ACTOR } from "@/lib/workflow/engine";

/**
 * Housekeeping the drain runs alongside the queue.
 */

/**
 * An enquiry is routed — emails queued, status set — when the parent
 * confirms the grade on the second screen. A parent who closes the tab
 * between the two screens leaves an application in `new_enquiry` with no
 * next action and no timeline. After ten minutes this routes it as it
 * stands, so the family still gets the "we've received your enquiry" email
 * with a link to carry on, and staff see it in the pipeline.
 */
export async function sweepUnroutedEnquiries(admin: AdminClient): Promise<number> {
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data, error } = await admin
    .from("applications")
    .select("id, reference, status, entry_route, requires_assessment, child_first_name, contacts(first_name, last_name)")
    .eq("status", "new_enquiry")
    .is("next_action", null)
    .lt("created_at", cutoff)
    .limit(50);
  if (error) throw new Error(error.message);

  let routed = 0;
  for (const row of data ?? []) {
    const c = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts;
    const parent = c ? `${(c as { first_name: string }).first_name} ${(c as { last_name: string }).last_name}` : "Parent";
    try {
      await onEnquiryCreated(admin, row, parent, SYSTEM_ACTOR);
      routed += 1;
    } catch (e) {
      // A conflict means somebody routed it in the meantime. Fine.
      console.warn("[sweep] could not route", row.reference, (e as Error).message);
    }
  }
  return routed;
}

export async function pruneRateLimits(admin: AdminClient): Promise<number> {
  const { data, error } = await admin.rpc("prune_rate_limits");
  if (error) throw new Error(error.message);
  return data ?? 0;
}
