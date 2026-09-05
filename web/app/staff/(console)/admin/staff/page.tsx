import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PERMISSION_CODES, PERMISSION_LABELS } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import { inviteStaff, updateRolePermissions, updateStaffAccess } from "./actions";

export default async function StaffAdminPage() {
  const { supabase } = await requireStaff("staff.write");
  const [{ data: staff }, { data: roles }, { data: rolePerms }, { data: staffRoles }, { data: staffCampuses }, { data: campuses }] =
    await Promise.all([
      supabase.from("staff_profiles").select("*").order("full_name"),
      supabase.from("roles").select("*").order("name"),
      supabase.from("role_permissions").select("*"),
      supabase.from("staff_roles").select("*"),
      supabase.from("staff_campuses").select("*"),
      supabase.from("campuses").select("id, name").eq("is_active", true).order("sort_order"),
    ]);

  const rolesOf = (id: string) => new Set((staffRoles ?? []).filter((r) => r.staff_id === id).map((r) => r.role_id));
  const campusesOf = (id: string) => new Set((staffCampuses ?? []).filter((r) => r.staff_id === id).map((r) => r.campus_id));
  const permsOf = (roleId: string) => new Set((rolePerms ?? []).filter((r) => r.role_id === roleId).map((r) => r.permission_code));

  return (
    <>
      <PageTitle title="Staff & roles" description="Who can sign in, what each role may do, and which campuses a person is limited to." />

      <section className="mb-6 rounded-xl border border-border bg-card p-4">
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
                <label key={r.id} className="flex items-center gap-1.5"><input type="checkbox" name="roleIds" value={r.id} /> {r.name}{r.campus_scoped ? <span className="text-xs text-muted-foreground">(needs a campus)</span> : null}</label>
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
            <div key={s.id} className="rounded-xl border border-border bg-card p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-medium">{s.full_name}</span>
                <span className="text-sm text-muted-foreground">{s.email}</span>
                {s.is_active ? <Badge variant="success">Active</Badge> : <Badge variant="muted">Deactivated</Badge>}
              </div>
              <ActionForm action={updateStaffAccess} label="Save" size="sm" variant="outline" className="space-y-2 text-sm">
                <input type="hidden" name="staffId" value={s.id} />
                <label className="flex items-center gap-1.5"><input type="checkbox" name="isActive" value="1" defaultChecked={s.is_active} /> Can sign in</label>
                <div className="flex flex-wrap gap-3">
                  {(roles ?? []).map((r) => (
                    <label key={r.id} className="flex items-center gap-1.5"><input type="checkbox" name="roleIds" value={r.id} defaultChecked={mine.has(r.id)} /> {r.name}</label>
                  ))}
                </div>
                <div className="flex flex-wrap gap-3 text-muted-foreground">
                  {(campuses ?? []).map((c) => (
                    <label key={c.id} className="flex items-center gap-1.5"><input type="checkbox" name="campusIds" value={c.id} defaultChecked={myCampuses.has(c.id)} /> {c.name}</label>
                  ))}
                </div>
              </ActionForm>
            </div>
          );
        })}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">What each role may do</h2>
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-xs">
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
                      <input type="checkbox" form={`role-${r.id}`} name="codes" value={code} defaultChecked={permsOf(r.id).has(code)} />
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td className="px-3 py-2"></td>
                {(roles ?? []).map((r) => (
                  <td key={r.id} className="px-2 py-2 text-center">
                    <RoleSaveForm roleId={r.id} />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function RoleSaveForm({ roleId }: { roleId: string }) {
  return (
    <ActionForm action={updateRolePermissions} label="Save" size="xs" variant="outline">
      <input type="hidden" name="roleId" value={roleId} form={`role-${roleId}`} />
      <RoleFormId id={`role-${roleId}`} />
    </ActionForm>
  );
}

/**
 * The matrix's checkboxes belong to a form per role via the `form`
 * attribute, so each column saves independently. This gives the ActionForm
 * the id those checkboxes reference.
 */
function RoleFormId({ id }: { id: string }) {
  return <input type="hidden" name="_" value="" id={id} />;
}
