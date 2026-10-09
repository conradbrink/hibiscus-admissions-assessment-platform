import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";

/**
 * The active members of staff who hold a permission and may see a campus:
 * who an alert about an application at that campus goes to. A person with no
 * campus rows sees every campus, as `can_access_campus()` says.
 *
 * Holding `admin` alone does not put a person on these lists; an alert about
 * a teacher's reference is for the HR team, not every administrator.
 */
export async function staffWithPermission(admin: AdminClient, code: string, campusId: string): Promise<{ id: string; email: string; name: string }[]> {
  const { data: grants, error } = await admin.from("role_permissions").select("role_id").eq("permission_code", code);
  if (error) throw new Error(error.message);
  const roleIds = (grants ?? []).map((g) => g.role_id);
  if (!roleIds.length) return [];

  const { data: holders, error: holdersError } = await admin.from("staff_roles").select("staff_id").in("role_id", roleIds);
  if (holdersError) throw new Error(holdersError.message);
  const staffIds = [...new Set((holders ?? []).map((h) => h.staff_id))];
  if (!staffIds.length) return [];

  const [{ data: profiles, error: profileError }, { data: campuses, error: campusError }] = await Promise.all([
    admin.from("staff_profiles").select("id, email, full_name, is_active").in("id", staffIds),
    admin.from("staff_campuses").select("staff_id, campus_id").in("staff_id", staffIds),
  ]);
  if (profileError) throw new Error(profileError.message);
  if (campusError) throw new Error(campusError.message);

  const restricted = new Map<string, Set<string>>();
  for (const row of campuses ?? []) {
    if (!restricted.has(row.staff_id)) restricted.set(row.staff_id, new Set());
    restricted.get(row.staff_id)!.add(row.campus_id);
  }
  return (profiles ?? [])
    .filter((p) => p.is_active)
    .filter((p) => !restricted.has(p.id) || restricted.get(p.id)!.has(campusId))
    .map((p) => ({ id: p.id, email: p.email, name: p.full_name }));
}
