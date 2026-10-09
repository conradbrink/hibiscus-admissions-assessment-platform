import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { HrActorType, HrSensitivity, Json } from "@/lib/supabase/types";

export type Actor = { type: HrActorType; id: string | null; label: string | null };

export const SYSTEM: Actor = { type: "system", id: null, label: "system" };

/**
 * One row in `hr_audit_log`, written by the code path that made the change.
 * A failure to audit fails the action: a salary change nobody can trace is
 * worse than a salary change that has to be pressed again.
 */
export async function audit(
  admin: AdminClient,
  actor: Actor,
  entry: {
    action: string;
    entityType: string;
    entityId?: string | null;
    campusId?: string | null;
    applicationId?: string | null;
    employeeId?: string | null;
    sensitivity?: HrSensitivity;
    before?: Json | null;
    after?: Json | null;
    ipHash?: string | null;
  }
): Promise<void> {
  const { error } = await admin.from("hr_audit_log").insert({
    actor_type: actor.type,
    actor_id: actor.id,
    actor_label: actor.label,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    campus_id: entry.campusId ?? null,
    hr_application_id: entry.applicationId ?? null,
    hr_employee_id: entry.employeeId ?? null,
    sensitivity: entry.sensitivity ?? "normal",
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip_hash: entry.ipHash ?? null,
  });
  if (error) throw new Error(`Could not write the audit log: ${error.message}`);
}

export function staffActor(ctx: { userId: string; profile: { email: string } }): Actor {
  return { type: "staff", id: ctx.userId, label: ctx.profile.email };
}
