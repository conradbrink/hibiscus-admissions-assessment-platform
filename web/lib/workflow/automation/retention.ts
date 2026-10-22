import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminClient } from "@/lib/supabase/admin";
import { removeDocumentObjects } from "@/lib/documents/storage";
import { getSettings, type Settings } from "@/lib/settings";
import type { Database } from "@/lib/supabase/types";
import { ABANDONED_STATUSES, CLOSED_STATUSES, retentionCandidates } from "@/lib/workflow/automation/rules";
import { commit, SYSTEM_ACTOR, type Actor } from "@/lib/workflow/engine";

export { ABANDONED_STATUSES, CLOSED_STATUSES, retentionCandidates };

/**
 * Data retention: applications that went nowhere, and applications that
 * closed, are anonymised after a period the school sets. One function in
 * the database removes the personal data; this module decides which rows,
 * deletes the stored files first, and records what it did. A hold on the
 * application excludes it until somebody clears the hold.
 *
 * Ticketed events are the other half: once an event is `event_retention_days`
 * behind us, `anonymise_event_orders()` removes its buyers' and ticket
 * holders' names, addresses and numbers, and keeps the counts and amounts.
 * They are nobody's application, so they have their own function, run by
 * the same switch.
 */

const SELECT = "id, reference, status, status_changed_at, retention_hold, retention_hold_reason, anonymised_at, child_first_name, child_last_name, campus_id, campuses(name)";

/** Everything that could be due, through whichever client: the preview uses the staff client so RLS scopes it. */
export async function loadRetentionCandidates(client: SupabaseClient<Database>, settings: Settings, now = new Date()) {
  const { data, error } = await client
    .from("applications")
    .select(SELECT)
    .in("status", [...ABANDONED_STATUSES, ...CLOSED_STATUSES])
    .is("anonymised_at", null)
    .order("status_changed_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  return { due: retentionCandidates(rows, settings, now), held: rows.filter((r) => r.retention_hold) };
}

/** Anonymises one application: files first, then the one database function, then the record of it. */
export async function anonymiseApplication(admin: AdminClient, applicationId: string, actor: Actor): Promise<void> {
  await removeDocumentObjects(admin, applicationId);
  const { error } = await admin.rpc("anonymise_application", { p_application_id: applicationId });
  if (error) throw new Error(error.message);
  await commit(admin, {
    applicationId,
    expectedStatus: null,
    newStatus: null,
    nextAction: null,
    event: { type: "application.anonymised", summary: "Personal data removed under the retention policy", payload: {} },
    audit: { action: "application.anonymised", entityType: "application", entityId: applicationId },
    actor,
  });
}

const RUN_KEY = "retention";
const DAILY_MS = 20 * 3_600_000;

/**
 * The daily run. The drain calls this every few minutes; it does nothing
 * until a day has passed since the last run, and nothing at all unless the
 * switch is on. `force` is the admin page's "Run now".
 */
export async function anonymiseExpired(admin: AdminClient, opts: { force?: boolean; actor?: Actor } = {}): Promise<{ anonymised: number; failed: number; skipped: string | null }> {
  const settings = await getSettings(admin);
  if (!settings.retentionEnabled && !opts.force) return { anonymised: 0, failed: 0, skipped: "retention is switched off" };
  if (!opts.force) {
    const { data: last } = await admin.from("maintenance_runs").select("last_run_at").eq("key", RUN_KEY).maybeSingle();
    if (last && Date.now() - new Date(last.last_run_at).getTime() < DAILY_MS) return { anonymised: 0, failed: 0, skipped: "already ran today" };
  }
  const { due } = await loadRetentionCandidates(admin, settings);
  let anonymised = 0;
  let failed = 0;
  for (const app of due.slice(0, 50)) {
    try {
      await anonymiseApplication(admin, app.id, opts.actor ?? SYSTEM_ACTOR);
      anonymised += 1;
    } catch (e) {
      failed += 1;
      console.error("[retention] could not anonymise", app.reference, (e as Error).message);
    }
  }
  let eventOrders = 0;
  try {
    eventOrders = await anonymiseEndedEvents(admin, settings);
  } catch (e) {
    failed += 1;
    console.error("[retention] could not anonymise event orders", (e as Error).message);
  }
  await admin.from("maintenance_runs").upsert({ key: RUN_KEY, last_run_at: new Date().toISOString(), detail: { anonymised, failed, due: due.length, event_orders: eventOrders } });
  return { anonymised, failed, skipped: null };
}

/**
 * Every ticketed event that ended more than `event_retention_days` ago and
 * still has a buyer on record. An event with no end time ends the day after
 * it starts, as its sales do (`eventStillAhead`).
 */
export async function anonymiseEndedEvents(admin: AdminClient, settings: Settings, now = new Date()): Promise<number> {
  const cutoff = now.getTime() - settings.eventRetentionDays * 86_400_000;
  const { data: sales, error } = await admin.from("event_sales").select("event_id");
  if (error) throw new Error(error.message);
  if (!sales?.length) return 0;
  const { data: events, error: eErr } = await admin
    .from("crm_events")
    .select("id, starts_at, ends_at")
    .in("id", sales.map((s) => s.event_id))
    .lt("starts_at", new Date(cutoff).toISOString());
  if (eErr) throw new Error(eErr.message);
  let removed = 0;
  for (const event of events ?? []) {
    const ended = event.ends_at ? new Date(event.ends_at).getTime() : new Date(event.starts_at).getTime() + 86_400_000;
    if (ended >= cutoff) continue;
    const { data, error: rErr } = await admin.rpc("anonymise_event_orders", { p_event_id: event.id });
    if (rErr) throw new Error(rErr.message);
    removed += data ?? 0;
  }
  return removed;
}
