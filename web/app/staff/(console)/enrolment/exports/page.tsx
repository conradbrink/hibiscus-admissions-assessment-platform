import Link from "next/link";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";

type Search = { campus?: string; intake?: string; all?: string };

/** A batch taken in the school system's own layout, rather than the configurable one. */
function isTemplateBatch(columnsSnapshot: unknown): boolean {
  const first = Array.isArray(columnsSnapshot) ? columnsSnapshot[0] : null;
  const path = (first as { source_path?: string } | null)?.source_path ?? "";
  return path.startsWith("ed-admin:");
}

/**
 * Enrolled students as a file for the student management system. The
 * columns are configuration; each record remembers the batch that carried
 * it, so "not yet exported" is the default view and nothing is sent twice
 * by accident. Reads through RLS: a campus team exports its own students.
 */
export default async function ExportsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { supabase } = await requireStaff("data.export");
  const includeExported = sp.all === "1";

  let q = supabase
    .from("student_records")
    .select("id, application_id, generated_at, export_status, exported_at, export_count, export_batch_id, applications!inner(reference, child_first_name, child_last_name, campus_id, intake_id, campuses(name, code), grades!applications_grade_id_fkey(name), intakes(label))")
    .order("generated_at", { ascending: false })
    .limit(500);
  if (sp.campus) q = q.eq("applications.campus_id", sp.campus);
  if (sp.intake) q = q.eq("applications.intake_id", sp.intake);
  if (!includeExported) q = q.eq("export_status", "pending");

  const [{ data: records }, { data: campuses }, { data: intakes }, { data: batches }, { data: columns }] = await Promise.all([
    q,
    supabase.from("v_accessible_campuses").select("id, name, code").order("sort_order"),
    supabase.from("intakes").select("id, label").order("starts_on", { ascending: false }).limit(12),
    supabase.from("student_exports").select("*, staff_profiles(full_name), campuses(name)").order("created_at", { ascending: false }).limit(20),
    supabase.from("export_columns").select("header, source_path").eq("is_active", true).order("position"),
  ]);
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const rows = records ?? [];

  return (
    <>
      <PageTitle title="Student export" description="Enrolled students as a CSV or JSON file for the student management system. Each download is a batch; records remember which batch carried them." />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <NativeSelect name="campus" defaultValue={sp.campus ?? ""} className="w-44">
          <option value="">All campuses</option>
          {(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
        <NativeSelect name="intake" defaultValue={sp.intake ?? ""} className="w-44">
          <option value="">Any intake</option>
          {(intakes ?? []).map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
        </NativeSelect>
        <label className="flex h-9 items-center gap-1.5 text-sm"><input type="checkbox" name="all" value="1" defaultChecked={includeExported} /> Include already exported</label>
        <Button type="submit" size="lg" variant="secondary">Show</Button>
      </form>

      {rows.length ? (
        <>
          <form method="post" action="/staff/enrolment/exports/download" className="mb-4 surface p-4">
            <input type="hidden" name="campus" value={sp.campus ?? ""} />
            <input type="hidden" name="intake" value={sp.intake ?? ""} />
            <input type="hidden" name="all" value={includeExported ? "1" : "0"} />
            <h2 className="text-sm font-semibold">Two files, in the school system&rsquo;s own layout</h2>
            <p className="mt-1 mb-3 max-w-2xl text-xs text-muted-foreground">
              Parent details and student details are separate files, as that system requires. The only thing in both is
              the <strong>family code</strong>, which is how it puts brothers and sisters on one account and sends one
              statement. Take the parent file first, then the student file — the student file is the one that records
              the transfer and marks these records as sent.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" name="layout" value="parent" size="lg" variant="outline">Parent details (CSV)</Button>
              <Button type="submit" name="layout" value="student" size="lg">Student details (CSV) — {rows.length}</Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Ed-admin knows a stage by its own name — <code>Stage5-HPS</code>, <code>NURSERY-TLK</code> — and ignores
              any other spelling, so a child whose stage is not mapped is refused rather than sent without one.{" "}
              <Link href="/staff/admin/ed-admin-grades" className="underline">Check the stage names</Link>.
            </p>
            <details className="mt-4">
              <summary className="cursor-pointer text-xs text-muted-foreground">Or the older, configurable layout</summary>
              <p className="mt-2 mb-2 text-xs text-muted-foreground">
                {(columns ?? []).length} columns: {(columns ?? []).map((c) => c.header).join(", ")}.{" "}
                <Link href="/staff/admin/export-columns" className="underline">Change the columns</Link>.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" name="layout" value="custom" size="sm" variant="outline">Download CSV</Button>
                <Button type="submit" name="layout" value="custom-json" size="sm" variant="ghost">Download JSON</Button>
              </div>
            </details>
          </form>
          <div className="overflow-x-auto surface">
            <table className="data-table">
              <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Student</th>
                  <th className="px-3 py-2 font-medium">Campus · Grade · Intake</th>
                  <th className="px-3 py-2 font-medium">Record generated</th>
                  <th className="px-3 py-2 font-medium">Export</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => {
                  const a = one(r.applications);
                  return (
                    <tr key={r.id}>
                      <td className="px-3 py-2">
                        <Link href={`/staff/registrations/${r.application_id}`} className="font-medium hover:underline">{a?.child_first_name} {a?.child_last_name}</Link>
                        <span className="block font-mono text-xs text-muted-foreground">{a?.reference}</span>
                      </td>
                      <td className="px-3 py-2">{one(a?.campuses)?.name} · {one(a?.grades)?.name} · {one(a?.intakes)?.label}</td>
                      <td className="px-3 py-2 text-muted-foreground">{formatDateTime(r.generated_at)}</td>
                      <td className="px-3 py-2">
                        <Badge variant={r.export_status === "exported" ? "success" : "muted"}>{r.export_status}</Badge>
                        {r.exported_at ? <span className="ml-2 text-xs text-muted-foreground">{formatDate(r.exported_at)} · {r.export_count}×</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <EmptyState>{includeExported ? "No enrolled students match." : "Nothing waiting to be exported. Tick “Include already exported” to re-download."}</EmptyState>
      )}

      <h2 className="mt-8 mb-2 text-sm font-semibold">Batches</h2>
      {batches && batches.length ? (
        <ul className="divide-y divide-border surface text-sm">
          {batches.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <span className="w-36 shrink-0 text-xs text-muted-foreground">{formatDateTime(b.created_at)}</span>
              <span className="font-mono text-xs">{b.filename}</span>
              <span className="text-xs text-muted-foreground">{b.record_count} record(s) · {one(b.campuses)?.name ?? "all campuses"} · {one(b.staff_profiles)?.full_name ?? "—"}</span>
              {/* A batch made from the school system's templates can be taken
                  again as either half, so the pair always matches. */}
              {isTemplateBatch(b.columns_snapshot) ? (
                <span className="ml-auto flex gap-3 text-xs">
                  <Link href={`/staff/enrolment/exports/download?batch=${b.id}&layout=parent`} prefetch={false} className="text-primary underline underline-offset-2">Parents again</Link>
                  <Link href={`/staff/enrolment/exports/download?batch=${b.id}&layout=student`} prefetch={false} className="text-primary underline underline-offset-2">Students again</Link>
                </span>
              ) : (
                <Link href={`/staff/enrolment/exports/download?batch=${b.id}`} prefetch={false} className="ml-auto text-xs text-primary underline underline-offset-2">Download again</Link>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>No batches yet.</EmptyState>
      )}
    </>
  );
}
