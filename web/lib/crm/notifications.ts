import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { NotificationKind } from "@/lib/supabase/types";

/**
 * Telling a person something, in the console.
 *
 * A notification is a row the topbar bell counts and the notifications
 * page lists. Written under the service role by whichever piece of code
 * knows the fact — a reply arrived, a task was assigned, a campaign wants
 * approval — and read by that person only. Best-effort: a notice that could
 * not be written is logged and never fails the thing it was about.
 */
export type Notice = {
  kind: NotificationKind;
  title: string;
  body?: string | null;
  href?: string | null;
  familyId?: string | null;
};

export async function notifyStaff(admin: AdminClient, staffId: string | null | undefined, notice: Notice): Promise<void> {
  if (!staffId) return;
  const { error } = await admin.from("notifications").insert({
    staff_id: staffId,
    kind: notice.kind,
    title: notice.title.slice(0, 200),
    body: notice.body ?? null,
    href: notice.href ?? null,
    family_id: notice.familyId ?? null,
  });
  if (error) console.error("[notifications] insert failed", { staffId, kind: notice.kind, error: error.message });
}

/**
 * Everyone who holds a permission, for the notices that belong to a role
 * rather than a person: a campaign waiting for approval goes to every
 * approver. `admin` satisfies every permission, so the super administrator
 * is on every such list.
 */
export async function staffWithPermission(admin: AdminClient, permission: string): Promise<string[]> {
  const { data, error } = await admin
    .from("staff_roles")
    .select("staff_id, roles!inner(role_permissions!inner(permission_code)), staff_profiles!inner(is_active)")
    .in("roles.role_permissions.permission_code", [permission, "admin"])
    .eq("staff_profiles.is_active", true);
  if (error) {
    console.error("[notifications] could not list permission holders", { permission, error: error.message });
    return [];
  }
  return [...new Set((data ?? []).map((r) => r.staff_id))];
}

export async function notifyPermissionHolders(admin: AdminClient, permission: string, notice: Notice, except?: string | null): Promise<number> {
  const ids = (await staffWithPermission(admin, permission)).filter((id) => id !== except);
  await Promise.all(ids.map((id) => notifyStaff(admin, id, notice)));
  return ids.length;
}
