import Link from "next/link";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { FAMILY_COLUMNS } from "@/lib/crm/csv";
import { formatDateTime } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";
import { uploadImport } from "./actions";

/**
 * Families and parents from a spreadsheet. The file is previewed first —
 * every row judged, duplicates found — and nothing is written until the
 * person confirms. Students are not imported here: a child joins the
 * register through enrolment, from a registration a person has checked
 * (see AGENTS.md, "A student outlives their application").
 */
export default async function ImportPage() {
  const { supabase } = await requireStaff("crm.import");
  const [{ data: imports }, { data: campuses }] = await Promise.all([
    supabase.from("crm_imports").select("*").order("created_at", { ascending: false }).limit(30),
    supabase.from("v_accessible_campuses").select("id, name, code").order("sort_order"),
  ]);
  return (
    <>
      <PageTitle back={{ href: "/staff/crm/settings", label: "CRM settings" }} title="Import" description="A CSV of families or parents. It is checked and shown to you before a single row is written." />
      <div className="grid gap-4 lg:grid-cols-2">
        <ActionForm action={uploadImport} label="Upload and preview" size="lg" resetOnSubmit={false} className="surface space-y-3 p-5">
          <label className="text-xs"><span className="mb-1 block text-muted-foreground">What the file holds</span>
            <NativeSelect name="kind" defaultValue="families"><option value="families">Families: one row per family with its primary parent</option><option value="contacts">Contacts: parents to attach to families already here</option></NativeSelect>
          </label>
          <label className="text-xs"><span className="mb-1 block text-muted-foreground">Campus for rows that name none</span>
            <NativeSelect name="campusId" defaultValue=""><option value="">Each row must say</option>{(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
          </label>
          <label className="text-xs"><span className="mb-1 block text-muted-foreground">CSV file (up to 2 MB)</span><input type="file" name="file" accept=".csv,text/csv" required className="block text-sm" /></label>
        </ActionForm>
        <section className="surface p-5 text-sm">
          <h2 className="font-semibold">The columns</h2>
          <p className="mt-1 text-xs text-muted-foreground">A header row, then one row per person. Required: first_name, last_name, email. Common spellings (surname, phone, cell) are recognised. Campus is the campus code: {(campuses ?? []).map((c) => c.code).join(", ")}.</p>
          <p className="mt-2 font-mono text-xs">{FAMILY_COLUMNS.join(", ")}</p>
          <p className="mt-2 text-xs text-muted-foreground">Consent columns (marketing_email, marketing_whatsapp, sms, whatsapp_updates) take yes or no, and mean the parent actually said so.</p>
        </section>
      </div>
      <h2 className="mt-6 mb-2 text-sm font-semibold">Previous imports</h2>
      {imports?.length ? (
        <ul className="divide-y divide-border surface text-sm">
          {imports.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <Link href={`/staff/crm/import/${i.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{i.filename}</Link>
              <span className="text-xs text-muted-foreground">{i.kind} · {i.total_rows} rows · {i.imported_rows} imported · {i.duplicate_rows} duplicates · {i.error_rows} errors · {formatDateTime(i.created_at)}</span>
              <Badge variant={i.status === "committed" ? "success" : i.status === "cancelled" ? "muted" : "warning"}>{i.status}</Badge>
            </li>
          ))}
        </ul>
      ) : <EmptyState>No imports yet.</EmptyState>}
    </>
  );
}
