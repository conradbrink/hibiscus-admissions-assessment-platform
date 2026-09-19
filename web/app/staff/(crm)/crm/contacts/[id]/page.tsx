import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { CHANNEL_LABELS, RELATIONSHIP_LABELS } from "@/lib/crm/labels";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import { STATUS_LABELS } from "@/lib/workflow/states";
import type { ApplicationStatus } from "@/lib/supabase/types";
import { setConsent, updateContact } from "../actions";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** One parent: who they are, how to reach them, what they agreed to, and the children they guard. */
export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, permissions } = await requireStaff("crm.read");
  const canWrite = can(permissions, "crm.write");
  const { data: contact } = await supabase.from("contacts").select("*, families!contacts_family_id_fkey(id, display_name, family_code)").eq("id", id).maybeSingle();
  if (!contact) notFound();
  const fam = one(contact.families);
  const [{ data: guardianOf }, { data: applications }, { data: students }] = await Promise.all([
    supabase.from("application_guardians").select("relationship, is_primary, applications(id, reference, child_first_name, child_last_name, status)").eq("contact_id", id),
    supabase.from("applications").select("id, reference, child_first_name, child_last_name, status, created_at").eq("contact_id", id).order("created_at", { ascending: false }),
    fam ? supabase.from("students").select("id, legal_first_name, legal_last_name, preferred_name, status").eq("family_id", fam.id) : Promise.resolve({ data: [] as never[] }),
  ]);

  return (
    <>
      <PageTitle back={fam ? { href: `/staff/crm/families/${fam.id}`, label: `${fam.display_name ?? fam.family_code} family` } : { href: "/staff/crm/contacts", label: "Contacts" }} title={`${contact.first_name} ${contact.last_name}`} description={`${RELATIONSHIP_LABELS[contact.relationship]}${fam ? ` · ${fam.display_name ?? fam.family_code} family` : ""}`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="surface p-5">
          <h2 className="mb-3 text-sm font-semibold">Details</h2>
          {canWrite ? (
            <ActionForm action={updateContact} label="Save" size="sm" resetOnSubmit={false} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="contactId" value={contact.id} />
              <label className="text-xs"><span className="mb-1 block text-muted-foreground">First name</span><Input name="firstName" defaultValue={contact.first_name} required /></label>
              <label className="text-xs"><span className="mb-1 block text-muted-foreground">Surname</span><Input name="lastName" defaultValue={contact.last_name} required /></label>
              <label className="text-xs"><span className="mb-1 block text-muted-foreground">Email</span><Input name="email" type="email" defaultValue={contact.email} required /></label>
              <label className="text-xs"><span className="mb-1 block text-muted-foreground">Mobile</span><Input name="mobile" defaultValue={contact.mobile ?? ""} placeholder="+267 71 234 567" /></label>
              <label className="text-xs"><span className="mb-1 block text-muted-foreground">Relationship</span>
                <NativeSelect name="relationship" defaultValue={contact.relationship}>
                  {Object.entries(RELATIONSHIP_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </NativeSelect>
              </label>
              <label className="text-xs"><span className="mb-1 block text-muted-foreground">Preferred channel</span>
                <NativeSelect name="preferredChannel" defaultValue={contact.preferred_channel ?? ""}>
                  <option value="">Not said</option>
                  {Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </NativeSelect>
              </label>
              <label className="text-xs sm:col-span-2"><span className="mb-1 block text-muted-foreground">Notes</span><Textarea name="notes" rows={3} defaultValue={contact.notes ?? ""} /></label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="isActive" defaultChecked={contact.is_active} /> Active contact</label>
            </ActionForm>
          ) : (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">Email</dt><dd>{contact.email}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Mobile</dt><dd>{contact.mobile ?? "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Preferred channel</dt><dd>{contact.preferred_channel ?? "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Notes</dt><dd>{contact.notes ?? "—"}</dd></div>
            </dl>
          )}
        </section>

        <section className="surface p-5">
          <h2 className="mb-1 text-sm font-semibold">Consent</h2>
          <p className="mb-3 text-xs text-muted-foreground">Recorded with a time and who changed it. A parent who replies STOP on WhatsApp clears both WhatsApp boxes; an unsubscribe link clears marketing email.</p>
          {canWrite ? (
            <ActionForm action={setConsent} label="Save consent" size="sm" resetOnSubmit={false} className="space-y-2">
              <input type="hidden" name="contactId" value={contact.id} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="whatsappOptIn" defaultChecked={contact.whatsapp_opt_in} /> WhatsApp updates about their own children <span className="text-xs text-muted-foreground">{contact.whatsapp_opt_in_at ? `since ${formatDate(contact.whatsapp_opt_in_at)} (${contact.whatsapp_opt_in_source})` : contact.whatsapp_opt_out_at ? `off since ${formatDate(contact.whatsapp_opt_out_at)}` : ""}</span></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="marketingEmail" defaultChecked={contact.marketing_email_consent && !contact.unsubscribed_at} /> Marketing email <span className="text-xs text-muted-foreground">{contact.unsubscribed_at ? `unsubscribed ${formatDateTime(contact.unsubscribed_at)}` : contact.marketing_email_consent_at ? `since ${formatDate(contact.marketing_email_consent_at)}` : ""}</span></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="marketingWhatsapp" defaultChecked={contact.marketing_whatsapp_consent} /> Marketing on WhatsApp <span className="text-xs text-muted-foreground">{contact.marketing_whatsapp_consent_at ? `since ${formatDate(contact.marketing_whatsapp_consent_at)}` : ""}</span></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="sms" defaultChecked={contact.sms_consent} /> SMS <span className="text-xs text-muted-foreground">{contact.sms_consent_at ? `since ${formatDate(contact.sms_consent_at)}` : ""}</span></label>
              <p className="text-xs text-muted-foreground">Source: {contact.consent_source ?? "not recorded"}</p>
            </ActionForm>
          ) : (
            <ul className="space-y-1 text-sm">
              <li>WhatsApp updates: {contact.whatsapp_opt_in ? "yes" : "no"}</li>
              <li>Marketing email: {contact.marketing_email_consent && !contact.unsubscribed_at ? "yes" : "no"}</li>
              <li>Marketing WhatsApp: {contact.marketing_whatsapp_consent ? "yes" : "no"}</li>
              <li>SMS: {contact.sms_consent ? "yes" : "no"}</li>
            </ul>
          )}
        </section>

        <section className="surface p-5">
          <h2 className="mb-2 text-sm font-semibold">Children</h2>
          {students?.length ? (
            <ul className="space-y-1 text-sm">{students.map((s) => <li key={s.id}><Link href={`/staff/students/${s.id}`} className="hover:underline">{s.preferred_name || s.legal_first_name} {s.legal_last_name}</Link> <span className="text-xs text-muted-foreground">· {s.status}</span></li>)}</ul>
          ) : <p className="text-sm text-muted-foreground">None enrolled under this family.</p>}
          {(applications?.length || guardianOf?.length) ? (
            <>
              <h3 className="mt-3 mb-1 text-xs font-semibold text-muted-foreground uppercase">Applications</h3>
              <ul className="space-y-1 text-sm">
                {(applications ?? []).map((a) => <li key={a.id}><Link href={`/staff/applications/${a.id}`} className="hover:underline">{a.child_first_name} {a.child_last_name}</Link> <span className="text-xs text-muted-foreground">· {a.reference} · {STATUS_LABELS[a.status as ApplicationStatus]}</span></li>)}
                {(guardianOf ?? []).map((g, i) => { const a = one(g.applications); return a ? <li key={`g${i}`}><Link href={`/staff/applications/${a.id}`} className="hover:underline">{a.child_first_name} {a.child_last_name}</Link> <span className="text-xs text-muted-foreground">· {g.relationship}{g.is_primary ? " (primary)" : ""}</span></li> : null; })}
              </ul>
            </>
          ) : null}
        </section>

        <section className="surface p-5 text-sm">
          <h2 className="mb-2 text-sm font-semibold">Record</h2>
          <p className="text-xs text-muted-foreground">Family code {contact.family_code ?? "—"} · created {formatDateTime(contact.created_at)} · updated {formatDateTime(contact.updated_at)}</p>
          <Link href={`/staff/crm/whatsapp?contact=${contact.id}`} className="mt-2 inline-block text-xs font-medium text-primary hover:underline">WhatsApp conversation</Link>
        </section>
      </div>
    </>
  );
}
