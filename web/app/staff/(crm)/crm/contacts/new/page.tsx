import { notFound } from "next/navigation";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { CHANNEL_LABELS, familyName, RELATIONSHIP_LABELS } from "@/lib/crm/labels";
import { requireStaff } from "@/lib/staff/session";
import { createContact } from "../actions";

/** A second parent or guardian on a family that exists. Consent is set on the contact afterwards, once they have said. */
export default async function NewContactPage({ searchParams }: { searchParams: Promise<{ family?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireStaff("crm.write");
  if (!sp.family) notFound();
  const { data: family } = await supabase.from("families").select("id, display_name, family_code").eq("id", sp.family).maybeSingle();
  if (!family) notFound();
  return (
    <>
      <PageTitle back={{ href: `/staff/crm/families/${family.id}`, label: familyName(family) }} title="Add a contact" description="Another parent or guardian on this family. They share the family code." />
      <ActionForm action={createContact} label="Save contact" size="lg" resetOnSubmit={false} className="surface grid max-w-2xl gap-3 p-5 sm:grid-cols-2">
        <input type="hidden" name="familyId" value={family.id} />
        <label className="text-xs"><span className="mb-1 block text-muted-foreground">First name</span><Input name="firstName" required maxLength={80} /></label>
        <label className="text-xs"><span className="mb-1 block text-muted-foreground">Surname</span><Input name="lastName" required maxLength={80} /></label>
        <label className="text-xs"><span className="mb-1 block text-muted-foreground">Email</span><Input name="email" type="email" required maxLength={200} /></label>
        <label className="text-xs"><span className="mb-1 block text-muted-foreground">Mobile (with country code)</span><Input name="mobile" maxLength={40} placeholder="+267 71 234 567" /></label>
        <label className="text-xs"><span className="mb-1 block text-muted-foreground">Relationship</span>
          <NativeSelect name="relationship" defaultValue="parent">{Object.entries(RELATIONSHIP_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect>
        </label>
        <label className="text-xs"><span className="mb-1 block text-muted-foreground">Preferred channel</span>
          <NativeSelect name="preferredChannel" defaultValue=""><option value="">Not said</option>{Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect>
        </label>
        <label className="text-xs sm:col-span-2"><span className="mb-1 block text-muted-foreground">Notes</span><Textarea name="notes" rows={2} maxLength={2000} /></label>
      </ActionForm>
    </>
  );
}
