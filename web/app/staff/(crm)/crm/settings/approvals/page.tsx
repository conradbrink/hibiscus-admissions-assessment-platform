import Link from "next/link";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { CAMPAIGN_CATEGORY_LABELS, SENSITIVE_CATEGORIES } from "@/lib/crm/labels";
import { getSettings } from "@/lib/settings";
import { requireStaff } from "@/lib/staff/session";
import { saveCrmSetting } from "../actions";

export default async function ApprovalsSettingsPage() {
  const { supabase } = await requireStaff("settings.write");
  const [settings, { data: approvers }, { data: senior }] = await Promise.all([
    getSettings(supabase),
    supabase.from("role_permissions").select("permission_code, roles(name)").in("permission_code", ["crm.campaigns.approve", "admin"]),
    supabase.from("role_permissions").select("permission_code, roles(name)").in("permission_code", ["crm.campaigns.approve_sensitive", "admin"]),
  ]);
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const names = (rows: typeof approvers) => [...new Set((rows ?? []).map((r) => one(r.roles)?.name).filter(Boolean))].join(", ");
  return (
    <>
      <PageTitle back={{ href: "/staff/crm/settings", label: "CRM settings" }} title="Campaign approval" description="Who signs off a campaign, and which kinds need a senior signature. Who holds each permission is set under People and permissions." />
      <div className="space-y-4">
        <ActionForm action={saveCrmSetting} label="Save" size="xs" variant="outline" resetOnSubmit={false} className="surface flex flex-wrap items-center gap-3 px-4 py-3">
          <input type="hidden" name="key" value="crm_campaign_approval_required" />
          <div className="min-w-0 flex-1"><p className="text-sm font-medium">A second person must approve every campaign</p><p className="text-xs text-muted-foreground">true: the person who wrote it may never approve it. false: someone who holds the approval permission may approve their own.</p></div>
          <Input name="value" defaultValue={String(settings.crmCampaignApprovalRequired)} className="h-8 w-20 font-mono md:h-8" />
        </ActionForm>
        <section className="surface p-4 text-sm">
          <p><span className="font-medium">May approve a campaign:</span> {names(approvers) || "nobody yet"}</p>
          <p className="mt-1"><span className="font-medium">May approve a sensitive campaign:</span> {names(senior) || "nobody yet"}</p>
          <p className="mt-2 text-xs text-muted-foreground">Sensitive categories, fixed by the school: {[...SENSITIVE_CATEGORIES].map((c) => CAMPAIGN_CATEGORY_LABELS[c]).join(", ")}. They are service messages: every family in the audience receives them whatever their marketing consent.</p>
          <Link href="/staff/admin/staff" className="mt-2 inline-block text-xs font-medium text-primary hover:underline">People and permissions</Link>
        </section>
      </div>
    </>
  );
}
