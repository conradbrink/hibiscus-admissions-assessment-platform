import Link from "next/link";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { StatusBadge } from "@/components/staff/status-badge";
import { Badge } from "@/components/ui/badge";
import { daysAgoDateString, formatDateTime } from "@/lib/format-date";
import { registrationCompleteness, SECTION_LABELS, SECTIONS } from "@/lib/registration/completeness";
import { requireStaff } from "@/lib/staff/session";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * Registrations: who is still filling in, who is waiting for a person to
 * confirm enrolment, who is enrolled. Completeness is computed with the
 * same rule the parent's review page uses. Campus scoping applies.
 */
export default async function RegistrationsPage() {
  const { supabase } = await requireStaff("applications.read");
  const since = `${daysAgoDateString(30)}T00:00:00+02:00`;
  const { data: apps } = await supabase
    .from("applications")
    .select("id, reference, status, status_changed_at, child_first_name, child_last_name, campuses(name), grades!applications_grade_id_fkey(name, sort_order)")
    .or(`status.in.(registration_incomplete,registration_complete),and(status.eq.enrolled,status_changed_at.gte.${since})`)
    .order("status_changed_at", { ascending: true });
  const ids = (apps ?? []).map((a) => a.id);
  const [{ data: registrations }, { data: contacts }, { data: documents }, { data: requirements }, { data: templates }, { data: acceptances }] = ids.length
    ? await Promise.all([
        supabase.from("registrations").select("*").in("application_id", ids),
        supabase.from("registration_contacts").select("*").in("application_id", ids),
        supabase.from("documents").select("*").in("application_id", ids).is("deleted_at", null),
        supabase.from("document_requirements").select("*").eq("is_active", true),
        supabase.from("agreement_templates").select("*").eq("is_active", true),
        supabase.from("agreement_acceptances").select("*").in("application_id", ids),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];

  const rows = (apps ?? []).map((a) => {
    const grade = one(a.grades);
    const c = registrationCompleteness({
      registration: (registrations ?? []).find((r) => r.application_id === a.id) ?? null,
      contacts: (contacts ?? []).filter((x) => x.application_id === a.id),
      documents: (documents ?? []).filter((x) => x.application_id === a.id),
      requirements: requirements ?? [],
      gradeSort: grade?.sort_order ?? 0,
      agreementTemplates: templates ?? [],
      acceptances: (acceptances ?? []).filter((x) => x.application_id === a.id),
    });
    const pendingDocs = (documents ?? []).filter((d) => d.application_id === a.id && !d.superseded_by && d.review_status === "pending").length;
    return { a, c, pendingDocs, campus: one(a.campuses)?.name, grade: grade?.name };
  });
  const groups = [
    { key: "incomplete", title: "Still registering", rows: rows.filter((r) => r.a.status === "registration_incomplete") },
    { key: "confirm", title: "Awaiting enrolment confirmation", note: "Registration complete. Check the documents, then confirm.", rows: rows.filter((r) => r.a.status === "registration_complete") },
    { key: "enrolled", title: "Enrolled in the last 30 days", rows: rows.filter((r) => r.a.status === "enrolled") },
  ];

  return (
    <>
      <PageTitle title="Registrations" description="The last stretch: what each family still has to give, the documents to check, and enrolment to confirm." />
      {groups.map((g) => (
        <section key={g.key} className="mb-8">
          <h2 className="mb-1 text-sm font-semibold">{g.title} ({g.rows.length})</h2>
          {g.note ? <p className="mb-2 text-xs text-muted-foreground">{g.note}</p> : null}
          {g.rows.length ? (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Applicant</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Since</th><th className="px-3 py-2 font-medium">Outstanding</th><th className="px-3 py-2 font-medium">Documents to check</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {g.rows.map(({ a, c, pendingDocs, campus, grade }) => {
                    const todo = SECTIONS.filter((s) => !c.sections[s]).map((s) => SECTION_LABELS[s]);
                    return (
                      <tr key={a.id}>
                        <td className="px-3 py-2"><Link href={`/staff/registrations/${a.id}`} className="font-medium hover:underline">{a.child_first_name} {a.child_last_name}</Link><span className="ml-2 text-xs text-muted-foreground">{grade} · {campus} · {a.reference}</span></td>
                        <td className="px-3 py-2"><StatusBadge status={a.status} /></td>
                        <td className="px-3 py-2 text-xs">{formatDateTime(a.status_changed_at)}</td>
                        <td className="px-3 py-2 text-xs">{todo.length ? todo.join(", ") : <span className="text-success">complete</span>}{c.missingDocuments.length ? <span className="block text-warning-foreground">missing: {c.missingDocuments.map((d) => d.label).join(", ")}</span> : null}{c.rejectedDocuments.length ? <span className="block text-destructive">re-upload: {c.rejectedDocuments.map((d) => d.label).join(", ")}</span> : null}</td>
                        <td className="px-3 py-2">{pendingDocs ? <Badge variant="warning">{pendingDocs} to review</Badge> : <span className="text-xs text-muted-foreground">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState>None.</EmptyState>
          )}
        </section>
      ))}
    </>
  );
}
