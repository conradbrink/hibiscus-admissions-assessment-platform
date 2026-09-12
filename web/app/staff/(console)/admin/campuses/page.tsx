import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { requireStaff } from "@/lib/staff/session";
import { createCampus, saveCampus } from "./actions";

export default async function CampusesPage() {
  const { supabase } = await requireStaff("settings.write");
  const { data: campuses } = await supabase.from("campuses").select("*").order("sort_order");

  return (
    <>
      <PageTitle back={{ href: "/staff/admin", label: "Settings" }} title="Campuses" description="Inactive campuses are never offered to parents. Country and currency drive fees and legal wording later." />
      <div className="space-y-3">
        {(campuses ?? []).map((c) => (
          <ActionForm key={c.id} action={saveCampus} label="Save" size="sm" variant="outline" className="grid gap-2 surface p-4 sm:grid-cols-[1fr_1fr_100px_100px_1fr_auto] sm:items-end">
            <input type="hidden" name="campusId" value={c.id} />
            <div><span className="text-xs text-muted-foreground">Name · <span className="font-mono">{c.code}</span></span><Input name="name" defaultValue={c.name} required /></div>
            <div><span className="text-xs text-muted-foreground">Descriptor</span><Input name="descriptor" defaultValue={c.descriptor ?? ""} /></div>
            <div><span className="text-xs text-muted-foreground">Country</span>
              <NativeSelect name="country" defaultValue={c.country}><option value="BW">BW</option><option value="ZA">ZA</option></NativeSelect></div>
            <div><span className="text-xs text-muted-foreground">Currency</span>
              <NativeSelect name="currency" defaultValue={c.currency}><option value="BWP">BWP</option><option value="ZAR">ZAR</option></NativeSelect></div>
            <div><span className="text-xs text-muted-foreground">Address and phone (one per line; printed on letters)</span><Textarea name="address" rows={3} defaultValue={c.address ?? ""} /></div>
            <label className="flex h-9 items-center gap-1.5 text-sm"><input type="checkbox" name="isActive" value="1" defaultChecked={c.is_active} /> Active</label>
            {/* The same two numbers on their own, because a link needs them
                that way: the address above prints, these two are tapped. */}
            <div className="sm:col-span-6 grid gap-2 border-t border-border pt-3 sm:grid-cols-[1fr_1fr_1fr] sm:items-end">
              <div><span className="text-xs text-muted-foreground">Office number (parents tap to call)</span><Input name="phone" type="tel" defaultValue={c.phone ?? ""} placeholder="+267 392 4299" /></div>
              <div><span className="text-xs text-muted-foreground">WhatsApp number (parents tap to chat)</span><Input name="whatsapp" type="tel" defaultValue={c.whatsapp ?? ""} placeholder="+267 72 320 145" /></div>
              <div className="sm:col-span-2"><span className="text-xs text-muted-foreground">Maps link (parents tap for directions; leave empty and the address stands alone)</span><Input name="mapsUrl" type="url" defaultValue={c.maps_url ?? ""} placeholder="https://maps.app.goo.gl/…" /></div>
              <p className="text-xs text-muted-foreground">Shown on the parent&rsquo;s pages and in the &ldquo;Talk to our admissions team&rdquo; message. Leave one empty and that way of reaching you is simply not offered.</p>
            </div>
            <div className="sm:col-span-6 grid gap-2 border-t border-border pt-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
              <div><span className="text-xs text-muted-foreground">Head of campus (signs the offer letter)</span><Input name="headName" defaultValue={c.head_name ?? ""} placeholder="Full name" /></div>
              <div><span className="text-xs text-muted-foreground">Title</span><Input name="headTitle" defaultValue={c.head_title ?? ""} placeholder="Head of School" /></div>
              <div><span className="text-xs text-muted-foreground">Signature image (PNG or JPEG, up to 300 KB, on a white or clear background)</span><input type="file" name="signature" accept="image/png,image/jpeg" className="block h-9 w-full text-sm" /></div>
              <div className="flex items-center gap-3">
                {c.signature_data_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a data URL held in the database, not an optimisable asset
                  <img src={c.signature_data_url} alt={`${c.head_name ?? "Head"}'s signature`} className="h-10 rounded border border-border bg-white px-1" />
                ) : <span className="text-xs text-muted-foreground">No signature yet</span>}
                {c.signature_data_url ? <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="removeSignature" value="1" /> Remove</label> : null}
              </div>
            </div>
          </ActionForm>
        ))}
      </div>
      <section className="mt-6 surface p-4">
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
