import Link from "next/link";
import { PageTitle } from "@/components/staff/page-title";
import { HEARD_FROM_OPTIONS } from "@/lib/heard-from";
import { requireStaff } from "@/lib/staff/session";

/** The answers to "how did you hear about us?", shared with the enquiry form, with how many families gave each. */
export default async function LeadSourcesSettingsPage() {
  const { supabase } = await requireStaff("crm.read");
  const { data } = await supabase.rpc("crm_lead_source_report", { p_campus_id: null, p_from: null });
  const byKey = new Map((data ?? []).map((r) => [r.lead_source, r]));
  return (
    <>
      <PageTitle back={{ href: "/staff/crm/settings", label: "CRM settings" }} title="Lead sources" description="The list the enquiry form offers a parent. It is one list for the funnel and the CRM, kept in code (web/lib/heard-from.ts) so the two never drift; adding a source is a small change there and to the database's check." />
      <section className="surface overflow-x-auto">
        <table className="data-table">
          <thead><tr><th>Key</th><th>What the parent reads</th><th className="text-right">Families</th><th className="text-right">Enquiries</th><th className="text-right">Enrolled</th></tr></thead>
          <tbody>
            {HEARD_FROM_OPTIONS.map((o) => { const r = byKey.get(o.key); return <tr key={o.key}><td className="font-mono text-xs">{o.key}</td><td><Link href={`/staff/crm/families?source=${o.key}`} className="hover:underline">{o.label}</Link></td><td className="text-right tabular-nums">{r?.families ?? 0}</td><td className="text-right tabular-nums">{r?.enquiries ?? 0}</td><td className="text-right tabular-nums">{r?.enrolled ?? 0}</td></tr>; })}
            <tr><td className="font-mono text-xs">not_asked</td><td className="text-muted-foreground">Enquiries from before the question existed, and walk-ins where it was skipped</td><td className="text-right tabular-nums">{byKey.get("not_asked")?.families ?? 0}</td><td className="text-right tabular-nums">{byKey.get("not_asked")?.enquiries ?? 0}</td><td className="text-right tabular-nums">{byKey.get("not_asked")?.enrolled ?? 0}</td></tr>
          </tbody>
        </table>
      </section>
    </>
  );
}
