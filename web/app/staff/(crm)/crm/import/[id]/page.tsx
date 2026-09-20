import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import type { ImportRecord } from "@/lib/crm/csv";
import type { ParentRowData, StudentRowData } from "@/lib/crm/ed-admin-import-server";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";
import type { CrmImportKind } from "@/lib/supabase/types";
import { cancelImport, confirmImport } from "../actions";

const KIND_LABELS: Record<CrmImportKind, string> = {
  ed_admin_parents: "Ed-admin parents",
  ed_admin_students: "Ed-admin students",
  families: "Families CSV",
  contacts: "Contacts CSV",
};

type Cells = { name: string; detail: string; contact: string; place: string; family: string };

/** The four cells a row shows, whichever file it came from. Error rows carry only what could be read. */
function cellsFor(kind: CrmImportKind, data: unknown): Cells {
  const d = (data ?? {}) as Record<string, unknown>;
  const s = (k: string): string => (typeof d[k] === "string" ? (d[k] as string) : "");
  if (kind === "ed_admin_students") {
    const r = d as Partial<StudentRowData>;
    return {
      name: [r.first_name, r.last_name].filter(Boolean).join(" ") || "(no name)",
      detail: [r.date_of_birth ? formatDate(r.date_of_birth) : "", r.gender ?? "", r.admission_number ? `№ ${r.admission_number}` : ""].filter(Boolean).join(" · "),
      contact: r.status_raw ? `Ed-admin: ${r.status_raw}` : "",
      place: r.grade_name ? `${r.grade_name} · ${r.campus_name}` : (r.grade_code ?? ""),
      family: r.family_name ? `${r.family_name} (${r.family_code})` : (r.family_code ?? ""),
    };
  }
  if (kind === "ed_admin_parents") {
    const r = d as Partial<ParentRowData>;
    const guardians = r.guardians ?? [];
    const primary = guardians[r.primary_index ?? 0];
    return {
      name: guardians.length ? guardians.map((g) => `${g.first_name} ${g.last_name}`).join(" & ") : [s("first_name"), s("last_name")].filter(Boolean).join(" ") || "(no name)",
      detail: primary?.email ?? "",
      contact: primary?.mobile ?? "",
      place: r.address ?? "",
      family: r.family_code ?? s("family_code"),
    };
  }
  const r = d as Partial<ImportRecord> & { cells?: string[] };
  return {
    name: r.first_name ? `${r.first_name} ${r.last_name}` : (r.cells ?? []).slice(0, 3).join(" · "),
    detail: r.email ?? "",
    contact: r.mobile ?? "",
    place: r.campus ?? "",
    family: r.family_name ? `${r.family_name} family` : "",
  };
}

/** The preview: every row with its verdict, a choice on each duplicate, and one button that writes. */
export default async function ImportPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireStaff("crm.import");
  const { data: imp } = await supabase.from("crm_imports").select("*").eq("id", id).maybeSingle();
  if (!imp) notFound();
  const [{ data: rows }, { data: campuses }] = await Promise.all([
    supabase.from("crm_import_rows").select("*, families!crm_import_rows_duplicate_family_id_fkey(display_name, family_code)").eq("import_id", id).order("row_no"),
    supabase.from("v_accessible_campuses").select("id, name").order("sort_order"),
  ]);
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const tone = (s: string) => (s === "valid" || s === "imported" ? "success" : s === "duplicate" ? "warning" : s === "skipped" ? "muted" : "destructive");
  const previewing = imp.status === "previewed";
  const students = imp.kind === "ed_admin_students";
  const edAdmin = students || imp.kind === "ed_admin_parents";
  const noun = students ? "child" : "family";
  const headers = students
    ? ["Child", "Born · admission №", "Status in Ed-admin", "Stage · campus", "Family"]
    : edAdmin
      ? ["Guardians", "Email", "Mobile", "Address", "Family code"]
      : ["Name", "Email", "Mobile", "Campus", "Family"];
  return (
    <>
      <PageTitle back={{ href: "/staff/crm/import", label: "Import" }} title={imp.filename} description={`${KIND_LABELS[imp.kind]} · ${imp.total_rows} rows · ${imp.valid_rows} valid · ${imp.duplicate_rows} possible duplicates · ${imp.error_rows} errors${imp.committed_at ? ` · imported ${imp.imported_rows} on ${formatDateTime(imp.committed_at)}` : ""}`}>
        <Badge variant={imp.status === "committed" ? "success" : imp.status === "cancelled" ? "muted" : "warning"}>{imp.status}</Badge>
      </PageTitle>
      <ActionForm id="import-confirm" action={confirmImport} label={`Import ${imp.valid_rows} valid row${imp.valid_rows === 1 ? "" : "s"} and the chosen duplicates`} size="lg" resetOnSubmit={false} confirm={`Write these ${students ? "children" : "families"} now? This cannot be undone.`} className={previewing ? "" : "hidden"}>
        <input type="hidden" name="importId" value={id} />
        {students ? null : (
          <label className="text-xs"><span className="mb-1 block text-muted-foreground">Campus for {edAdmin ? "these families" : "rows that name none"}</span>
            <NativeSelect name="defaultCampusId" defaultValue={imp.campus_id ?? ""} className="w-64"><option value="">{edAdmin ? "Choose a campus" : "Each row must say"}</option>{(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
          </label>
        )}
      </ActionForm>
      {previewing ? <ActionForm action={cancelImport} label="Discard this import" size="xs" variant="ghost" className="mt-2"><input type="hidden" name="importId" value={id} /></ActionForm> : null}
      <div className="mt-4 overflow-x-auto surface">
        <table className="data-table">
          <thead><tr><th>#</th><th>Verdict</th>{headers.map((h) => <th key={h}>{h}</th>)}<th>Note</th>{previewing ? <th>Duplicate: what to do</th> : null}</tr></thead>
          <tbody>
            {(rows ?? []).map((r) => {
              const c = cellsFor(imp.kind, r.data);
              const dupFam = one(r.families);
              const existingStudent = students ? ((r.data ?? {}) as Partial<StudentRowData>).existing_student_code : null;
              return (
                <tr key={r.id}>
                  <td className="text-xs text-muted-foreground">{r.row_no}</td>
                  <td><Badge variant={tone(r.status)}>{r.status}</Badge></td>
                  <td>{c.name}</td>
                  <td className="text-xs">{c.detail}</td>
                  <td className="text-xs">{c.contact}</td>
                  <td className="text-xs">{c.place}</td>
                  <td className="text-xs">{c.family}</td>
                  <td className="text-xs text-muted-foreground">
                    {r.message}
                    {r.status === "imported" && r.student_id ? <> · <Link href={`/staff/students/${r.student_id}`} className="underline">open</Link></> : null}
                    {r.status === "imported" && !r.student_id && r.family_id ? <> · <Link href={`/staff/crm/families/${r.family_id}`} className="underline">open</Link></> : null}
                  </td>
                  {previewing ? (
                    <td>
                      {r.status === "duplicate" ? (
                        <NativeSelect name={`dup_${r.row_no}`} defaultValue={students ? (existingStudent ? "existing" : "skip") : r.duplicate_family_id ? "existing" : "skip"} form="import-confirm" className="h-8 w-60 py-0 text-xs md:h-8">
                          <option value="skip">Skip this row</option>
                          {students && existingStudent ? <option value="existing">Update existing: {existingStudent}</option> : null}
                          {!students && r.duplicate_family_id ? <option value="existing">Use existing: {dupFam?.display_name ?? dupFam?.family_code}</option> : null}
                          <option value="create">Create a new {noun} anyway</option>
                        </NativeSelect>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
