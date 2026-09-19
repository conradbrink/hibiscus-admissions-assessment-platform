import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import type { ImportRecord } from "@/lib/crm/csv";
import { formatDateTime } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";
import { cancelImport, confirmImport } from "../actions";

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
  return (
    <>
      <PageTitle back={{ href: "/staff/crm/import", label: "Import" }} title={imp.filename} description={`${imp.kind} · ${imp.total_rows} rows · ${imp.valid_rows} valid · ${imp.duplicate_rows} possible duplicates · ${imp.error_rows} errors${imp.committed_at ? ` · imported ${imp.imported_rows} on ${formatDateTime(imp.committed_at)}` : ""}`}>
        <Badge variant={imp.status === "committed" ? "success" : imp.status === "cancelled" ? "muted" : "warning"}>{imp.status}</Badge>
      </PageTitle>
      <ActionForm id="import-confirm" action={confirmImport} label={`Import ${imp.valid_rows} valid row${imp.valid_rows === 1 ? "" : "s"} and the chosen duplicates`} size="lg" resetOnSubmit={false} confirm="Write these families now? This cannot be undone." className={previewing ? "" : "hidden"}>
        <input type="hidden" name="importId" value={id} />
        <label className="text-xs"><span className="mb-1 block text-muted-foreground">Campus for rows that name none</span>
          <NativeSelect name="defaultCampusId" defaultValue={imp.campus_id ?? ""} className="w-64"><option value="">Each row must say</option>{(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
        </label>
      </ActionForm>
      {previewing ? <ActionForm action={cancelImport} label="Discard this import" size="xs" variant="ghost" className="mt-2"><input type="hidden" name="importId" value={id} /></ActionForm> : null}
      <div className="mt-4 overflow-x-auto surface">
        <table className="data-table">
          <thead><tr><th>#</th><th>Verdict</th><th>Name</th><th>Email</th><th>Mobile</th><th>Campus</th><th>Note</th>{previewing ? <th>Duplicate: what to do</th> : null}</tr></thead>
          <tbody>
            {(rows ?? []).map((r) => {
              const d = r.data as unknown as Partial<ImportRecord> & { cells?: string[] };
              const dupFam = one(r.families);
              return (
                <tr key={r.id}>
                  <td className="text-xs text-muted-foreground">{r.row_no}</td>
                  <td><Badge variant={tone(r.status)}>{r.status}</Badge></td>
                  <td>{d.first_name ? `${d.first_name} ${d.last_name}` : <span className="text-xs text-muted-foreground">{(d.cells ?? []).slice(0, 3).join(" · ")}</span>}{d.family_name ? <span className="block text-xs text-muted-foreground">{d.family_name} family</span> : null}</td>
                  <td className="text-xs">{d.email ?? ""}</td>
                  <td className="text-xs">{d.mobile ?? ""}</td>
                  <td className="text-xs">{d.campus ?? ""}</td>
                  <td className="text-xs text-muted-foreground">{r.message}{r.family_id && r.status === "imported" ? <> · <Link href={`/staff/crm/families/${r.family_id}`} className="underline">open</Link></> : null}</td>
                  {previewing ? (
                    <td>
                      {r.status === "duplicate" ? (
                        <NativeSelect name={`dup_${r.row_no}`} defaultValue={r.duplicate_family_id ? "existing" : "skip"} form="import-confirm" className="h-8 w-56 py-0 text-xs md:h-8">
                          <option value="skip">Skip this row</option>
                          {r.duplicate_family_id ? <option value="existing">Use existing: {dupFam?.display_name ?? dupFam?.family_code}</option> : null}
                          <option value="create">Create anyway</option>
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
