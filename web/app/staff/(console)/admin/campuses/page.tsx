import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { requireStaff } from "@/lib/staff/session";
import { createCampus, saveCampus } from "./actions";

export default async function CampusesPage() {
  const { supabase } = await requireStaff("settings.write");
  const { data: campuses } = await supabase.from("campuses").select("*").order("sort_order");

  return (
    <>
      <PageTitle title="Campuses" description="Inactive campuses are never offered to parents. Country and currency drive fees and legal wording later." />
      <div className="space-y-3">
        {(campuses ?? []).map((c) => (
          <ActionForm key={c.id} action={saveCampus} label="Save" size="sm" variant="outline" className="grid gap-2 rounded-xl border border-border bg-card p-4 sm:grid-cols-[1fr_1fr_100px_100px_1fr_auto] sm:items-end">
            <input type="hidden" name="campusId" value={c.id} />
            <div><span className="text-xs text-muted-foreground">Name · <span className="font-mono">{c.code}</span></span><Input name="name" defaultValue={c.name} required /></div>
            <div><span className="text-xs text-muted-foreground">Descriptor</span><Input name="descriptor" defaultValue={c.descriptor ?? ""} /></div>
            <div><span className="text-xs text-muted-foreground">Country</span>
              <NativeSelect name="country" defaultValue={c.country}><option value="BW">BW</option><option value="ZA">ZA</option></NativeSelect></div>
            <div><span className="text-xs text-muted-foreground">Currency</span>
              <NativeSelect name="currency" defaultValue={c.currency}><option value="BWP">BWP</option><option value="ZAR">ZAR</option></NativeSelect></div>
            <div><span className="text-xs text-muted-foreground">Address</span><Input name="address" defaultValue={c.address ?? ""} /></div>
            <label className="flex h-9 items-center gap-1.5 text-sm"><input type="checkbox" name="isActive" value="1" defaultChecked={c.is_active} /> Active</label>
          </ActionForm>
        ))}
      </div>
      <section className="mt-6 rounded-xl border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">Add a campus</h2>
        <ActionForm action={createCampus} label="Add" size="sm" className="grid gap-2 sm:grid-cols-3">
          <Input name="code" placeholder="code, e.g. mogoditshane" required pattern="[a-z0-9_]+" />
          <Input name="name" placeholder="Name" required />
          <Input name="descriptor" placeholder="Descriptor" />
        </ActionForm>
        <p className="mt-2 text-xs text-muted-foreground">Then tick the grades it offers under Grades.</p>
      </section>
    </>
  );
}
