import Link from "next/link";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { FAMILY_COLUMNS } from "@/lib/crm/csv";
import { formatDateTime } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";
import type { CrmImportKind } from "@/lib/supabase/types";
import { uploadImport } from "./actions";

const KIND_LABELS: Record<CrmImportKind, string> = {
  ed_admin_parents: "Ed-admin parents",
  ed_admin_students: "Ed-admin students",
  families: "Families CSV",
  contacts: "Contacts CSV",
};

/**
 * Families, parents and children from a file. Two shapes are read: the
 * school's other system's own exports (its Parents workbook and its
 * Students sheet, keyed on the family code), and a plain CSV in our own
 * columns. Every file is previewed first, row by row, duplicates found,
 * and nothing is written until the person confirms.
 *
 * Children come in only through the Ed-admin students file, which is the
 * register the school already keeps; a new child otherwise joins through
 * enrolment (see AGENTS.md, "A student outlives their application").
 */
export default async function ImportPage() {
  const { supabase } = await requireStaff("crm.import");
  const [{ data: imports }, { data: campuses }, { count: unmappedGrades }] = await Promise.all([
    supabase.from("crm_imports").select("*").order("created_at", { ascending: false }).limit(30),
    supabase.from("v_accessible_campuses").select("id, name, code").order("sort_order"),
    supabase.from("campus_grades").select("campus_id", { count: "exact", head: true }).eq("is_active", true).is("external_grade_code", null),
  ]);
  return (
    <>
      <PageTitle back={{ href: "/staff/crm/settings", label: "CRM settings" }} title="Import" description="Ed-admin's own exports, or a CSV in our columns. Every file is checked and shown to you before a single row is written." />
      <div className="grid gap-4 lg:grid-cols-2">
        <ActionForm action={uploadImport} label="Upload and preview" size="lg" resetOnSubmit={false} className="surface space-y-3 p-5">
          <label className="text-xs"><span className="mb-1 block text-muted-foreground">What the file holds</span>
            <NativeSelect name="kind" defaultValue="ed_admin_parents">
              <option value="ed_admin_parents">Ed-admin parents: the Parents workbook (Basic, G1 Contact, G1 Address…)</option>
              <option value="ed_admin_students">Ed-admin students: the Students sheet, one row per child</option>
              <option value="families">Families CSV: one row per family with its primary parent, our columns</option>
              <option value="contacts">Contacts CSV: parents to attach to families already here</option>
            </NativeSelect>
          </label>
          <label className="text-xs"><span className="mb-1 block text-muted-foreground">Campus for families that name none</span>
            <NativeSelect name="campusId" defaultValue=""><option value="">Each row must say</option>{(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
            <span className="mt-1 block text-muted-foreground">An Ed-admin parents file names no campus, so choose one here; each family moves to its children&apos;s campus once the students file is in.</span>
          </label>
          <label className="text-xs"><span className="mb-1 block text-muted-foreground">File: .xlsx or .csv, up to 5 MB</span><input type="file" name="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required className="block text-sm" /></label>
        </ActionForm>
        <div className="space-y-4">
          <section className="surface p-5 text-sm">
            <h2 className="font-semibold">From Ed-admin</h2>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-xs text-muted-foreground">
              <li>Export the <strong>Parents</strong> workbook and import it first. One family per family code; the guardians become its contacts, the family keeps that code as its own. A guardian needs an email address to become a contact; one without is noted on the family.</li>
              <li>Export the <strong>Students</strong> sheet and import it second. Each child joins the family its code names, at the campus and stage its Ed-admin grade name maps to, and is enrolled in the current year. A child already on the register is offered as an update, not added twice.</li>
              <li>An old-style <strong>.xls</strong> file must be saved as .xlsx in Excel first.</li>
            </ol>
            {unmappedGrades ? (
              <p className="mt-3 text-xs">
                <Badge variant="warning">{unmappedGrades}</Badge> {unmappedGrades === 1 ? "stage has" : "stages have"} no Ed-admin name yet, so a child in {unmappedGrades === 1 ? "it" : "them"} would be refused.{" "}
                <Link href="/staff/admin/ed-admin-grades" className="underline">Map the stage names</Link> first.
              </p>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">Every active stage has its Ed-admin name mapped. <Link href="/staff/admin/ed-admin-grades" className="underline">Check the names</Link> if a grade is refused.</p>
            )}
          </section>
          <section className="surface p-5 text-sm">
            <h2 className="font-semibold">A CSV in our columns</h2>
            <p className="mt-1 text-xs text-muted-foreground">A header row, then one row per person. Required: first_name, last_name, email. Common spellings (surname, phone, cell) are recognised. Campus is the campus code: {(campuses ?? []).map((c) => c.code).join(", ")}.</p>
            <p className="mt-2 font-mono text-xs">{FAMILY_COLUMNS.join(", ")}</p>
            <p className="mt-2 text-xs text-muted-foreground">Consent columns (marketing_email, marketing_whatsapp, sms, whatsapp_updates) take yes or no, and mean the parent actually said so.</p>
          </section>
        </div>
      </div>
      <h2 className="mt-6 mb-2 text-sm font-semibold">Previous imports</h2>
      {imports?.length ? (
        <ul className="divide-y divide-border surface text-sm">
          {imports.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <Link href={`/staff/crm/import/${i.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{i.filename}</Link>
              <span className="text-xs text-muted-foreground">{KIND_LABELS[i.kind]} · {i.total_rows} rows · {i.imported_rows} imported · {i.duplicate_rows} duplicates · {i.error_rows} errors · {formatDateTime(i.created_at)}</span>
              <Badge variant={i.status === "committed" ? "success" : i.status === "cancelled" ? "muted" : "warning"}>{i.status}</Badge>
            </li>
          ))}
        </ul>
      ) : <EmptyState>No imports yet.</EmptyState>}
    </>
  );
}
