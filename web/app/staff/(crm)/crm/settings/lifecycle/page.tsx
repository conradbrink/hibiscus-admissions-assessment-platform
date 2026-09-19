import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { LifecycleBadge } from "@/components/crm/bits";
import { LIFECYCLE_BLURB, LIFECYCLE_STAGES } from "@/lib/crm/lifecycle";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { requireStaff } from "@/lib/staff/session";
import { saveCrmSetting } from "../actions";

/** The stages, what moves a family between them, and the two timing settings. */
export default async function LifecycleSettingsPage() {
  const { supabase, permissions } = await requireStaff("crm.read");
  const settings = await getSettings(supabase);
  const canEdit = can(permissions, "settings.write");
  return (
    <>
      <PageTitle back={{ href: "/staff/crm/settings", label: "CRM settings" }} title="Lifecycle stages" description="Computed from admissions and the register, so nobody types the same fact twice. A person can set a stage by hand from the family's page, and hand it back." />
      <section className="surface mb-4">
        <table className="data-table"><thead><tr><th>Stage</th><th>What puts a family here</th></tr></thead>
          <tbody>{LIFECYCLE_STAGES.map((s) => <tr key={s}><td><LifecycleBadge stage={s} /></td><td className="text-sm">{LIFECYCLE_BLURB[s]}</td></tr>)}</tbody>
        </table>
      </section>
      <div className="space-y-2">
        {[
          ["crm_follow_up_days", "Days after a new enquiry by which a family should have been contacted", settings.crmFollowUpDays],
          ["crm_stale_contact_days", "Days without contact after which a family counts as \"no response\"", settings.crmStaleContactDays],
        ].map(([key, label, value]) => (
          <ActionForm key={String(key)} action={saveCrmSetting} label="Save" size="xs" variant="outline" resetOnSubmit={false} className="surface flex flex-wrap items-center gap-3 px-4 py-3">
            <input type="hidden" name="key" value={String(key)} />
            <div className="min-w-0 flex-1"><p className="text-sm">{label}</p><p className="font-mono text-[11px] text-muted-foreground">{key}</p></div>
            <Input name="value" defaultValue={String(value)} className="h-8 w-20 font-mono md:h-8" readOnly={!canEdit} />
          </ActionForm>
        ))}
      </div>
    </>
  );
}
