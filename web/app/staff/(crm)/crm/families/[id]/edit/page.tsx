import { notFound } from "next/navigation";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { CHANNEL_LABELS, familyName } from "@/lib/crm/labels";
import { HEARD_FROM_OPTIONS } from "@/lib/heard-from";
import { requireStaff } from "@/lib/staff/session";
import { updateFamily } from "../../actions";

export default async function EditFamilyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireStaff("crm.write");
  const [{ data: family }, { data: contacts }, { data: campuses }, { data: staff }] = await Promise.all([
    supabase.from("families").select("*").eq("id", id).maybeSingle(),
    supabase.from("contacts").select("id, first_name, last_name").eq("family_id", id).order("created_at"),
    supabase.from("v_accessible_campuses").select("id, name").order("sort_order"),
    supabase.from("staff_profiles").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);
  if (!family) notFound();

  return (
    <>
      <PageTitle back={{ href: `/staff/crm/families/${id}`, label: familyName(family) }} title="Edit family" description="The parents' own details are edited on each contact." />
      <ActionForm action={updateFamily} label="Save" size="lg" resetOnSubmit={false} className="max-w-3xl space-y-5">
        <input type="hidden" name="familyId" value={family.id} />
        <section className="surface grid gap-3 p-5 sm:grid-cols-2">
          <label className="text-xs"><span className="mb-1 block text-muted-foreground">Family name</span><Input name="displayName" defaultValue={family.display_name ?? ""} required maxLength={120} /></label>
          <label className="text-xs"><span className="mb-1 block text-muted-foreground">Campus</span>
            <NativeSelect name="campusId" defaultValue={family.campus_id ?? ""} required>
              <option value="" disabled>Choose a campus</option>
              {(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </NativeSelect>
          </label>
          <label className="text-xs sm:col-span-2"><span className="mb-1 block text-muted-foreground">Home address</span><Input name="homeAddress" defaultValue={family.home_address ?? ""} maxLength={500} /></label>
          <label className="text-xs"><span className="mb-1 block text-muted-foreground">Primary contact</span>
            <NativeSelect name="primaryContactId" defaultValue={family.primary_contact_id ?? ""}>
              <option value="">—</option>
              {(contacts ?? []).map((c) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
            </NativeSelect>
          </label>
          <label className="text-xs"><span className="mb-1 block text-muted-foreground">Secondary contact</span>
            <NativeSelect name="secondaryContactId" defaultValue={family.secondary_contact_id ?? ""}>
              <option value="">—</option>
              {(contacts ?? []).map((c) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
            </NativeSelect>
          </label>
          <label className="text-xs"><span className="mb-1 block text-muted-foreground">Preferred way to be contacted</span>
            <NativeSelect name="preferredChannel" defaultValue={family.preferred_channel ?? ""}>
              <option value="">Not said</option>
              {Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </NativeSelect>
          </label>
          <label className="text-xs"><span className="mb-1 block text-muted-foreground">Preferred language</span><Input name="preferredLanguage" defaultValue={family.preferred_language ?? ""} maxLength={60} /></label>
          <label className="text-xs"><span className="mb-1 block text-muted-foreground">Lead source</span>
            <NativeSelect name="leadSource" defaultValue={family.lead_source ?? ""}>
              <option value="">Not asked</option>
              {HEARD_FROM_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </NativeSelect>
          </label>
          <label className="text-xs"><span className="mb-1 block text-muted-foreground">Source detail</span><Input name="leadSourceDetail" defaultValue={family.lead_source_detail ?? ""} maxLength={200} /></label>
          <label className="text-xs"><span className="mb-1 block text-muted-foreground">Assigned to</span>
            <NativeSelect name="assignedStaffId" defaultValue={family.assigned_staff_id ?? ""}>
              <option value="">Nobody</option>
              {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </NativeSelect>
          </label>
          <label className="text-xs"><span className="mb-1 block text-muted-foreground">Next follow-up</span><Input type="date" name="nextFollowUp" defaultValue={family.next_follow_up_at?.slice(0, 10) ?? ""} /></label>
          <label className="text-xs"><span className="mb-1 block text-muted-foreground">Referred by (family id)</span><Input name="referredByFamilyId" defaultValue={family.referred_by_family_id ?? ""} className="font-mono" /></label>
          <label className="text-xs"><span className="mb-1 block text-muted-foreground">Referral note</span><Input name="referralNote" defaultValue={family.referral_note ?? ""} maxLength={300} /></label>
          <label className="text-xs sm:col-span-2"><span className="mb-1 block text-muted-foreground">Tags</span><Input name="tags" defaultValue={family.tags.join(", ")} placeholder="lower-case, separated by commas" /></label>
          <label className="text-xs sm:col-span-2"><span className="mb-1 block text-muted-foreground">Notes</span><Textarea name="notes" rows={4} defaultValue={family.notes ?? ""} maxLength={4000} /></label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="isActive" defaultChecked={family.is_active} /> Active family</label>
        </section>
      </ActionForm>
    </>
  );
}
