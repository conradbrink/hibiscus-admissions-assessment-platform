import Link from "next/link";
import { DuplicateCheck } from "@/components/crm/duplicate-check";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { CHANNEL_LABELS, RELATIONSHIP_LABELS } from "@/lib/crm/labels";
import { HEARD_FROM_OPTIONS } from "@/lib/heard-from";
import { requireStaff } from "@/lib/staff/session";
import { createFamily } from "../actions";

/**
 * A family typed in at the desk: a referral, a walk-in, a parent who rang.
 * The duplicate check runs while they type and again when they press Save.
 * An enquiry about a child is still an application: that is logged from
 * the applicant form, which this page links to, so the funnel and the CRM
 * agree about who enquired.
 */
export default async function NewFamilyPage({ searchParams }: { searchParams: Promise<{ referredBy?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireStaff("crm.write");
  const [{ data: campuses }, { data: staff }, { data: referrer }] = await Promise.all([
    supabase.from("v_accessible_campuses").select("id, name").order("sort_order"),
    supabase.from("staff_profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    sp.referredBy ? supabase.from("families").select("id, display_name, family_code").eq("id", sp.referredBy).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const formId = "new-family";

  return (
    <>
      <PageTitle back={{ href: "/staff/crm/families", label: "Families" }} title="Add a family" description="A family the school knows without an application yet. If a parent is enquiring about a child, log the enquiry instead: it creates the family too.">
        <Link href="/staff/applications/new" className="text-sm font-medium text-primary hover:underline">Log an enquiry instead</Link>
      </PageTitle>

      <ActionForm id={formId} action={createFamily} label="Save family" size="lg" resetOnSubmit={false} className="max-w-3xl space-y-5">
        <section className="surface space-y-3 p-5">
          <h2 className="text-sm font-semibold">The family</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs"><span className="mb-1 block text-muted-foreground">Family name</span><Input name="displayName" required maxLength={120} placeholder="Brink" /></label>
            <label className="text-xs"><span className="mb-1 block text-muted-foreground">Campus</span>
              <NativeSelect name="campusId" defaultValue="" required>
                <option value="" disabled>Choose a campus</option>
                {(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </NativeSelect>
            </label>
            <label className="text-xs sm:col-span-2"><span className="mb-1 block text-muted-foreground">Home address</span><Input name="homeAddress" maxLength={500} /></label>
            <label className="text-xs"><span className="mb-1 block text-muted-foreground">How did they hear about us?</span>
              <NativeSelect name="leadSource" defaultValue="">
                <option value="">Not asked</option>
                {HEARD_FROM_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </NativeSelect>
            </label>
            <label className="text-xs"><span className="mb-1 block text-muted-foreground">Source detail</span><Input name="leadSourceDetail" maxLength={200} placeholder="e.g. the billboard on Western Bypass" /></label>
            <label className="text-xs"><span className="mb-1 block text-muted-foreground">Referred by</span>
              {referrer ? (
                <>
                  <input type="hidden" name="referredByFamilyId" value={referrer.id} />
                  <Input value={`${referrer.display_name ?? referrer.family_code} family`} readOnly />
                </>
              ) : (
                <Input name="referredByFamilyId" placeholder="Paste a family id, or open the referring family and press Refer" />
              )}
            </label>
            <label className="text-xs"><span className="mb-1 block text-muted-foreground">Assigned to</span>
              <NativeSelect name="assignedStaffId" defaultValue="">
                <option value="">Nobody yet</option>
                {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </NativeSelect>
            </label>
            <label className="text-xs"><span className="mb-1 block text-muted-foreground">Preferred way to be contacted</span>
              <NativeSelect name="preferredChannel" defaultValue="">
                <option value="">Not said</option>
                {Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </NativeSelect>
            </label>
            <label className="text-xs"><span className="mb-1 block text-muted-foreground">Preferred language</span><Input name="preferredLanguage" maxLength={60} placeholder="English, Setswana…" /></label>
            <label className="text-xs sm:col-span-2"><span className="mb-1 block text-muted-foreground">Tags</span><Input name="tags" placeholder="lower-case, separated by commas: referral, robotics-interest" /></label>
            <label className="text-xs sm:col-span-2"><span className="mb-1 block text-muted-foreground">Notes</span><Textarea name="notes" rows={3} maxLength={2000} /></label>
          </div>
        </section>

        <section className="surface space-y-3 p-5">
          <h2 className="text-sm font-semibold">The primary parent or guardian</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs"><span className="mb-1 block text-muted-foreground">First name</span><Input name="firstName" required maxLength={80} /></label>
            <label className="text-xs"><span className="mb-1 block text-muted-foreground">Surname</span><Input name="lastName" required maxLength={80} /></label>
            <label className="text-xs"><span className="mb-1 block text-muted-foreground">Email</span><Input name="email" type="email" required maxLength={200} /></label>
            <label className="text-xs"><span className="mb-1 block text-muted-foreground">Mobile (with country code)</span><Input name="mobile" maxLength={40} placeholder="+267 71 234 567" /></label>
            <label className="text-xs"><span className="mb-1 block text-muted-foreground">Relationship to the children</span>
              <NativeSelect name="relationship" defaultValue="parent">
                {Object.entries(RELATIONSHIP_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </NativeSelect>
            </label>
          </div>
          <DuplicateCheck formId={formId} />
        </section>

        <section className="surface space-y-2 p-5">
          <h2 className="text-sm font-semibold">What they have agreed to</h2>
          <p className="text-xs text-muted-foreground">Only tick what the parent actually said. Service messages about their own child need none of these.</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="whatsappOptIn" /> WhatsApp updates about their own application and children</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="marketingEmail" /> Marketing email</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="marketingWhatsapp" /> Marketing on WhatsApp</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="sms" /> SMS</label>
        </section>
      </ActionForm>
    </>
  );
}
