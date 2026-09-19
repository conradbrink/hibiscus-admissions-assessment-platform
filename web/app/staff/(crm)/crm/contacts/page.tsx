import Link from "next/link";
import { ConsentDot, Pagination, queryBuilder } from "@/components/crm/bits";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { RELATIONSHIP_LABELS } from "@/lib/crm/labels";
import { requireStaff } from "@/lib/staff/session";

const PAGE = 50;

/**
 * Every parent and guardian, separately from their families: a person can
 * be reached, consented, and looked up on their own. Read through the
 * caller's client; a contact is visible when their family is.
 */
export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string; consent?: string; page?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireStaff("crm.read");
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  let q = supabase
    .from("contacts")
    .select("id, first_name, last_name, email, mobile, relationship, whatsapp_opt_in, marketing_email_consent, marketing_whatsapp_consent, sms_consent, unsubscribed_at, is_active, family_id, families!contacts_family_id_fkey(id, display_name, family_code, campuses!families_campus_id_fkey(name))", { count: "exact" })
    .order("last_name")
    .order("first_name")
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (sp.q?.trim()) {
    const term = sp.q.trim().replace(/[%,()]/g, " ").trim();
    const digits = term.replace(/[^0-9]/g, "");
    const parts = [`first_name.ilike.%${term}%`, `last_name.ilike.%${term}%`, `email.ilike.%${term}%`];
    if (digits.length >= 5) parts.push(`mobile_normalised.ilike.%${digits}%`);
    q = q.or(parts.join(","));
  }
  if (sp.consent === "email") q = q.eq("marketing_email_consent", true).is("unsubscribed_at", null);
  if (sp.consent === "whatsapp") q = q.eq("marketing_whatsapp_consent", true).eq("whatsapp_opt_in", true);
  if (sp.consent === "none") q = q.eq("marketing_email_consent", false).eq("marketing_whatsapp_consent", false);
  if (sp.consent === "unsubscribed") q = q.not("unsubscribed_at", "is", null);
  const { data: rows, count } = await q;
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const qs = queryBuilder(sp);

  return (
    <>
      <PageTitle title="Contacts" description={`${count ?? 0} parents and guardians`} />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <Input name="q" placeholder="Name, email or phone" defaultValue={sp.q ?? ""} className="w-64" />
        <NativeSelect name="consent" defaultValue={sp.consent ?? ""} className="w-52" aria-label="Consent">
          <option value="">Any consent</option>
          <option value="email">Consents to marketing email</option>
          <option value="whatsapp">Consents to marketing WhatsApp</option>
          <option value="none">No marketing consent</option>
          <option value="unsubscribed">Unsubscribed</option>
        </NativeSelect>
        <Button type="submit" size="lg" variant="secondary">Filter</Button>
      </form>
      {rows?.length ? (
        <div className="overflow-x-auto surface">
          <table className="data-table">
            <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Relationship</th><th>Family</th><th>Consent</th></tr></thead>
            <tbody>
              {rows.map((c) => {
                const fam = one(c.families);
                const campus = fam ? one(fam.campuses) : null;
                return (
                  <tr key={c.id} className={c.is_active ? "" : "opacity-60"}>
                    <td><Link href={`/staff/crm/contacts/${c.id}`} className="font-medium hover:underline">{c.first_name} {c.last_name}</Link></td>
                    <td className="text-xs">{c.mobile ?? "—"}</td>
                    <td className="text-xs">{c.email}</td>
                    <td className="text-xs">{RELATIONSHIP_LABELS[c.relationship]}</td>
                    <td className="text-xs">{fam ? <Link href={`/staff/crm/families/${fam.id}`} className="hover:underline">{fam.display_name ?? fam.family_code}</Link> : "—"}{campus ? <span className="text-muted-foreground"> · {campus.name}</span> : null}</td>
                    <td><span className="flex flex-wrap gap-2"><ConsentDot on={c.whatsapp_opt_in} label="Updates" /><ConsentDot on={c.marketing_email_consent && !c.unsubscribed_at} label="Email" /><ConsentDot on={c.marketing_whatsapp_consent} label="WhatsApp" /><ConsentDot on={c.sms_consent} label="SMS" /></span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <EmptyState>No contacts match.</EmptyState>}
      <Pagination page={page} pages={Math.max(1, Math.ceil((count ?? 0) / PAGE))} qs={qs} />
    </>
  );
}
