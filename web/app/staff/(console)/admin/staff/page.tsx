import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { can, PERMISSION_CODES, PERMISSION_LABELS, type PermissionCode } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteStaff, inviteStaff, resendInvite, resetStaffMfa, updateRolePermissions, updateStaffAccess } from "./actions";

export default async function StaffAdminPage() {
  const { supabase, userId, permissions } = await requireStaff("staff.write");
  // Managing people, changing what a role may do, and removing somebody are
  // three different powers. Most people who can do the first can do neither
  // of the others, so the screen shows the matrix as a reference and hides
  // the buttons that would refuse them.
  const canEditRoles = can(permissions, "roles.write");
  const canDelete = can(permissions, "staff.delete");
  const [{ data: staff }, { data: roles }, { data: rolePerms }, { data: staffRoles }, { data: staffCampuses }, { data: campuses }] =
    await Promise.all([
      supabase.from("staff_profiles").select("*").order("full_name"),
      supabase.from("roles").select("*").order("name"),
      supabase.from("role_permissions").select("*"),
      supabase.from("staff_roles").select("*"),
      supabase.from("staff_campuses").select("*"),
      supabase.from("campuses").select("id, name").eq("is_active", true).order("sort_order"),
    ]);
  // Whether each person has accepted their invitation lives in auth, which
  // only the service role can read. This page is already limited to
  // staff.write, and the map carries nothing but a yes/no per person.
  const { data: authUsers } = await createAdminClient().auth.admin.listUsers({ perPage: 1000 });
  // "Accepted" means they have actually signed in: the account is created
  // already confirmed, so a confirmation date proves nothing.
  const accepted = new Map((authUsers?.users ?? []).map((u) => [u.id, Boolean(u.last_sign_in_at)]));

  const rolesOf = (id: string) => new Set((staffRoles ?? []).filter((r) => r.staff_id === id).map((r) => r.role_id));
  const campusesOf = (id: string) => new Set((staffCampuses ?? []).filter((r) => r.staff_id === id).map((r) => r.campus_id));
  const permsOf = (roleId: string) => new Set((rolePerms ?? []).filter((r) => r.role_id === roleId).map((r) => r.permission_code));
  /**
   * A role can only be handed out by somebody who already holds everything it
   * carries — otherwise inviting a colleague as a super administrator would
   * be a way round every other check. The database refuses it too
   * (`can_grant_role`); this only keeps the tick box from being offered.
   */
  const canGrant = (roleId: string) =>
    [...permsOf(roleId)].every((code) => can(permissions, code as PermissionCode));
  const grantNote = (roleId: string) =>
    canGrant(roleId) ? "" : " — above what you hold";

  return (
    <>
      <PageTitle back={{ href: "/staff/admin", label: "Settings" }} title="Staff & roles" description="Who can sign in, what each role may do, and which campuses a person is limited to." />

      <section className="mb-6 surface p-4">
        <h2 className="mb-3 text-sm font-semibold">Invite a member of staff</h2>
        <ActionForm action={inviteStaff} label="Send invitation" className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="fullName">Full name</Label><Input id="fullName" name="fullName" required /></div>
            <div className="space-y-1"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" required /></div>
          </div>
          <fieldset className="text-sm">
            <legend className="mb-1 font-medium">Roles</legend>
            <div className="flex flex-wrap gap-3">
              {(roles ?? []).map((r) => (
                <label key={r.id} className={`flex items-center gap-1.5 ${canGrant(r.id) ? "" : "text-muted-foreground"}`}>
                  <input type="checkbox" name="roleIds" value={r.id} disabled={!canGrant(r.id)} /> {r.name}
                  {r.campus_scoped ? <span className="text-xs text-muted-foreground">(needs a campus)</span> : null}
                  {canGrant(r.id) ? null : <span className="text-xs">{grantNote(r.id)}</span>}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="text-sm">
            <legend className="mb-1 font-medium">Limit to campuses <span className="font-normal text-muted-foreground">(none = all, except for roles that need a campus)</span></legend>
            <div className="flex flex-wrap gap-3">
              {(campuses ?? []).map((c) => (
                <label key={c.id} className="flex items-center gap-1.5"><input type="checkbox" name="campusIds" value={c.id} /> {c.name}</label>
              ))}
            </div>
          </fieldset>
        </ActionForm>
      </section>

      <section className="mb-6 space-y-3">
        <h2 className="text-sm font-semibold">People</h2>
        {(staff ?? []).map((s) => {
          const mine = rolesOf(s.id);
          const myCampuses = campusesOf(s.id);
          return (
            <div key={s.id} className="surface p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-medium">{s.full_name}</span>
                <span className="text-sm text-muted-foreground">{s.email}</span>
                {s.is_active ? <Badge variant="success">Active</Badge> : <Badge variant="muted">Deactivated</Badge>}
                {accepted.get(s.id) === false ? <Badge variant="warning">Invitation not yet accepted</Badge> : null}
              </div>
              <div className="mb-3 flex flex-wrap gap-2">
                {accepted.get(s.id) === false && s.is_active ? (
                  <ActionForm action={resendInvite} label="Resend invitation" size="xs" variant="outline">
                    <input type="hidden" name="staffId" value={s.id} />
                  </ActionForm>
                ) : null}
                {s.id !== userId && s.is_active ? (
                  <ActionForm
                    action={resetStaffMfa}
                    label="Reset authenticator"
                    size="xs"
                    variant="outline"
                    confirm={`Clear ${s.full_name}'s authenticator app? Do this when they have lost the phone it was on. They will sign in with their password alone until they set a new one up, and this is recorded against your name.`}
                  >
                    <input type="hidden" name="staffId" value={s.id} />
                  </ActionForm>
                ) : null}
                {s.id !== userId && canDelete ? (
                  <ActionForm action={deleteStaff} label="Delete" size="xs" variant="ghost" confirm={`Delete ${s.full_name} completely? Their sign-in, roles and campus access are removed. Anything assigned to them (applications, tasks, sessions) is unassigned. Only possible while they have not decided, approved, marked or recorded anything; otherwise untick "Can sign in" instead.`}>
                    <input type="hidden" name="staffId" value={s.id} />
                  </ActionForm>
                ) : null}
              </div>
              <ActionForm action={updateStaffAccess} label="Save" size="sm" variant="outline" className="space-y-2 text-sm">
                <input type="hidden" name="staffId" value={s.id} />
                <label className="flex items-center gap-1.5"><input type="checkbox" name="isActive" value="1" defaultChecked={s.is_active} /> Can sign in</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" name="digestEnabled" value="1" defaultChecked={s.digest_enabled} /> Receives the morning digest</label>
                <div className="flex flex-wrap gap-3">
                  {(roles ?? []).map((r) => {
                    // Your own roles are not yours to change, and no role can
                    // be handed out above what you hold yourself.
                    const locked = (s.id === userId && !canEditRoles) || !canGrant(r.id);
                    return (
                      <label key={r.id} className={`flex items-center gap-1.5 ${locked ? "text-muted-foreground" : ""}`}>
                        <input type="checkbox" name="roleIds" value={r.id} defaultChecked={mine.has(r.id)} disabled={locked} />
                        {/* A disabled box submits nothing, which would read as
                            "role removed". This carries what they already have
                            through the save untouched. */}
                        {locked && mine.has(r.id) ? <input type="hidden" name="roleIds" value={r.id} /> : null}
                        {r.name}
                        {!canGrant(r.id) ? <span className="text-xs">{grantNote(r.id)}</span> : null}
                      </label>
                    );
                  })}
                </div>
                {s.id === userId && !canEditRoles ? (
                  <p className="text-xs text-muted-foreground">Your own roles and campuses can only be changed by a super administrator.</p>
                ) : null}
                <div className="flex flex-wrap gap-3 text-muted-foreground">
                  {(campuses ?? []).map((c) => {
                    const locked = s.id === userId && !canEditRoles;
                    return (
                      <label key={c.id} className="flex items-center gap-1.5">
                        <input type="checkbox" name="campusIds" value={c.id} defaultChecked={myCampuses.has(c.id)} disabled={locked} />
                        {locked && myCampuses.has(c.id) ? <input type="hidden" name="campusIds" value={c.id} /> : null}
                        {c.name}
                      </label>
                    );
                  })}
                </div>
              </ActionForm>
            </div>
          );
        })}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">What each role may do</h2>
        {canEditRoles ? null : (
          <p className="mb-2 text-xs text-muted-foreground">
            For reference. Changing what a role may do is a super administrator&rsquo;s job — it decides what everyone
            on the system can reach.
          </p>
        )}
        <div className="overflow-x-auto surface">
          <table className="data-table text-xs">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Permission</th>
                {(roles ?? []).map((r) => <th key={r.id} className="px-2 py-2 text-center font-medium">{r.name}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {PERMISSION_CODES.map((code) => (
                <tr key={code}>
                  <td className="px-3 py-1.5"><span className="font-mono">{code}</span><span className="block text-muted-foreground">{PERMISSION_LABELS[code]}</span></td>
                  {(roles ?? []).map((r) => (
                    <td key={r.id} className="px-2 py-1.5 text-center">
                      {canEditRoles ? (
                        <input type="checkbox" form={`role-${r.id}`} name="codes" value={code} defaultChecked={permsOf(r.id).has(code)} />
                      ) : (
                        <span className={permsOf(r.id).has(code) ? "text-foreground" : "text-muted-foreground/40"} aria-label={permsOf(r.id).has(code) ? "yes" : "no"}>
                          {permsOf(r.id).has(code) ? "✓" : "·"}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              {canEditRoles ? (
                <tr>
                  <td className="px-3 py-2"></td>
                  {(roles ?? []).map((r) => (
                    <td key={r.id} className="px-2 py-2 text-center">
                      <RoleSaveForm roleId={r.id} />
                    </td>
                  ))}
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/**
 * The matrix's checkboxes cannot sit inside the form — they are cells in
 * other rows of the table — so they belong to it through the `form`
 * attribute instead and each column saves on its own. That attribute has to
 * name the form element itself: pointed at anything else, the browser gives
 * those checkboxes no form at all and the column submits nothing.
 */
function RoleSaveForm({ roleId }: { roleId: string }) {
  return (
    <ActionForm id={`role-${roleId}`} action={updateRolePermissions} label="Save" size="xs" variant="outline">
      <input type="hidden" name="roleId" value={roleId} />
    </ActionForm>
  );
}
