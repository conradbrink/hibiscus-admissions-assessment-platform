import { PageTitle } from "@/components/staff/page-title";
import { InviteForm, RoleToggle } from "@/components/stores/settings-forms";
import { Badge } from "@/components/ui/badge";
import { requireStaff } from "@/lib/staff/session";

export const metadata = { title: "Users" };

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * Who may sign in to Stores, and as what. A Stores administrator gives and
 * takes away the two Stores roles here, and nothing else: people's other
 * access, and switching a sign-in off, stay with Admissions → Staff and roles.
 */
export default async function StoresUsersPage() {
  const { supabase, userId } = await requireStaff("stores.admin");
  const [{ data: staff }, { data: holders }] = await Promise.all([
    supabase.from("staff_profiles").select("id, full_name, email, is_active").order("full_name").limit(1000),
    supabase.from("staff_roles").select("staff_id, roles!inner(code)").in("roles.code", ["storekeeper", "stores_admin", "super_admin"]),
  ]);
  const rolesOf = new Map<string, Set<string>>();
  for (const h of holders ?? []) {
    const code = one(h.roles)?.code;
    if (!code) continue;
    rolesOf.set(h.staff_id, (rolesOf.get(h.staff_id) ?? new Set()).add(code));
  }
  const withAccess = (staff ?? []).filter((s) => rolesOf.has(s.id));
  const others = (staff ?? []).filter((s) => !rolesOf.has(s.id) && s.is_active);

  const Row = ({ s }: { s: { id: string; full_name: string; email: string; is_active: boolean } }) => {
    const r = rolesOf.get(s.id) ?? new Set<string>();
    const self = s.id === userId;
    return (
      <li className="surface flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{s.full_name}{self ? <span className="font-normal text-muted-foreground"> (you)</span> : null}</p>
          <p className="truncate text-xs text-muted-foreground">{s.email}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {r.has("super_admin") ? <Badge variant="info">Super administrator</Badge> : null}
            {r.has("stores_admin") ? <Badge>Stores administrator</Badge> : null}
            {r.has("storekeeper") ? <Badge variant="success">Storekeeper</Badge> : null}
            {!s.is_active ? <Badge variant="muted">Cannot sign in</Badge> : null}
          </div>
        </div>
        {!self && !r.has("super_admin") ? (
          <div className="flex flex-wrap gap-2">
            <RoleToggle staffId={s.id} role="storekeeper" granted={r.has("storekeeper")} label="storekeeper" />
            <RoleToggle staffId={s.id} role="stores_admin" granted={r.has("stores_admin")} label="Stores administrator" />
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageTitle title="Users" description="Who may sign in to Stores. Purchasing Officer / Storekeeper records stock; a Stores administrator also manages these settings, corrects counts and reverses transactions." back={{ href: "/staff/stores/settings", label: "Settings" }} />
      <section className="surface p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-semibold">Invite somebody new</h2>
        <InviteForm />
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold">With Stores access</h2>
        <ul className="space-y-2">{withAccess.map((s) => <Row key={s.id} s={s} />)}</ul>
      </section>
      {others.length ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Colleagues without Stores access</h2>
          <ul className="space-y-2">{others.map((s) => <Row key={s.id} s={s} />)}</ul>
        </section>
      ) : null}
    </div>
  );
}
