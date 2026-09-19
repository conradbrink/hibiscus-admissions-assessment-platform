import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";
import type { Actor } from "@/lib/workflow/engine";

/**
 * One line in the audit log for a CRM change.
 *
 * The same table the engine writes, the same shape: who, what, which row,
 * before and after. `family_id` scopes the line to the family so a campus
 * manager's audit tab shows their families' history and nobody else's.
 * Best-effort, like the message trail: a change that happened is not undone
 * because the line about it could not be written, but it is logged.
 */
export type CrmAudit = {
  action: string;
  entityType: "family" | "contact" | "opportunity" | "campaign" | "segment" | "event" | "event_registration" | "automation" | "note" | "task" | "import" | "consent";
  entityId?: string | null;
  familyId?: string | null;
  before?: Json;
  after?: Json;
};

export async function recordCrmAudit(admin: AdminClient, actor: Actor, entry: CrmAudit): Promise<void> {
  const { error } = await admin.from("audit_log").insert({
    actor_type: actor.type,
    actor_id: actor.id ?? null,
    actor_label: actor.label ?? null,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    family_id: entry.familyId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip_hash: actor.ipHash ?? null,
  });
  if (error) console.error("[crm audit] insert failed", { action: entry.action, error: error.message });
}

/** The columns worth keeping before-and-after for a family edit. */
export function pick<T extends Record<string, unknown>>(row: T, keys: readonly (keyof T)[]): Json {
  const out: Record<string, Json> = {};
  for (const k of keys) out[String(k)] = (row[k] ?? null) as Json;
  return out;
}
