import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { StatusBadge } from "@/components/staff/status-badge";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { registrationCompleteness, SECTION_LABELS, SECTIONS } from "@/lib/registration/completeness";
import { RELATIONSHIP_LABELS } from "@/lib/registration/schema";
import { requireStaff } from "@/lib/staff/session";
import { parseMismatchFlags } from "@/lib/documents/compare";
import { isExtractable } from "@/lib/documents/extraction-schemas";
import { DocumentReading } from "@/components/staff/document-reading";
import { askParentToConfirm, confirmEnrolment, extractDocument, reviewDocument, sendRegistrationReminder } from "../actions";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

function Row({ label, value }: { label: string; value: string | null | undefined | boolean }) {
  const text = typeof value === "boolean" ? (value ? "Yes" : "No") : value;
  return (
    <div className="grid grid-cols-[160px_1fr] gap-2 py-0.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-wrap">{text || "—"}</dd>
    </div>
  );
}

/** Everything the family gave, the documents to check, and the button that ends the journey. Reads through RLS. */
export default async function RegistrationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, permissions } = await requireStaff("applications.read");
  const canWrite = can(permissions, "applications.write");
  const { data: app } = await supabase
    .from("applications")
    .select("*, campuses(name), grades!applications_grade_id_fkey(name, sort_order), intakes(label), contacts(first_name, last_name, email, mobile)")
    .eq("id", id)
    .maybeSingle();
  if (!app) notFound();
  const grade = one(app.grades);

  const [{ data: registration }, { data: contacts }, { data: documents }, { data: requirements }, { data: templates }, { data: acceptances }, { data: record }] = await Promise.all([
    supabase.from("registrations").select("*").eq("application_id", id).maybeSingle(),
    supabase.from("registration_contacts").select("*").eq("application_id", id).order("kind").order("position"),
    supabase.from("documents").select("*, staff_profiles!documents_reviewed_by_fkey(full_name)").eq("application_id", id).is("deleted_at", null).order("uploaded_at", { ascending: false }),
    supabase.from("document_requirements").select("*").eq("is_active", true).order("sort_order"),
    supabase.from("agreement_templates").select("*").eq("is_active", true),
    supabase.from("agreement_acceptances").select("*").eq("application_id", id),
    supabase.from("student_records").select("*").eq("application_id", id).maybeSingle(),
  ]);
  const c = registrationCompleteness({
    registration: registration ?? null,
    contacts: contacts ?? [],
    documents: documents ?? [],
    requirements: requirements ?? [],
    gradeSort: grade?.sort_order ?? 0,
    agreementTemplates: templates ?? [],
    acceptances: acceptances ?? [],
  });
  const r = registration;
  const guardians = (contacts ?? []).filter((x) => x.kind !== "emergency");
  const emergency = (contacts ?? []).filter((x) => x.kind === "emergency");
  const liveDocs = (documents ?? []).filter((d) => !d.superseded_by);
  const idField = <input type="hidden" name="applicationId" value={app.id} />;
  const changed = Array.isArray(r?.prefill_changed) ? (r.prefill_changed as string[]) : [];
  const flags = parseMismatchFlags(r?.mismatch_flags);
  const extractorOn = (process.env.DOCUMENT_EXTRACTOR ?? "none") !== "none";

  return (
    <>
      <PageTitle title={`${app.child_first_name} ${app.child_last_name}`} description={`${grade?.name} · ${one(app.campuses)?.name} · ${one(app.intakes)?.label} · ${app.reference} · `}>
        <StatusBadge status={app.status} />
      </PageTitle>
      <p className="-mt-4 mb-4 text-xs"><Link href={`/staff/applications/${app.id}`} className="text-primary underline underline-offset-2">Applicant page</Link></p>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Documents</h2>
            <ul className="mt-2 divide-y divide-border">
              {(requirements ?? [])
                .filter((q) => (q.grade_sort_min === null || q.grade_sort_min <= (grade?.sort_order ?? 0)) && (q.grade_sort_max === null || q.grade_sort_max >= (grade?.sort_order ?? 0)))
                .map((q) => {
                  const d = liveDocs.find((x) => x.requirement_code === q.code) ?? null;
                  return (
                    <li key={q.code} className="py-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{q.label}</span>
                        {!q.required ? <span className="text-xs text-muted-foreground">optional</span> : null}
                        {d ? (
                          <Badge variant={d.review_status === "accepted" ? "success" : d.review_status === "rejected" ? "destructive" : "warning"}>{d.review_status}</Badge>
                        ) : (
                          <Badge variant={q.required ? "warning" : "secondary"}>{q.required ? "missing" : "not supplied"}</Badge>
                        )}
                        {d?.scan_status !== undefined && d ? <span className="text-xs text-muted-foreground">{d.scan_status === "not_scanned" ? "not virus-scanned" : d.scan_status}</span> : null}
                      </div>
                      {d ? (
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Link href={`/staff/registrations/${app.id}/documents/${d.id}`} className="font-medium text-primary underline underline-offset-2" prefetch={false} target="_blank" rel="noopener">View {d.original_filename}</Link>
                          <span>{Math.round(d.size_bytes / 1024)} KB · uploaded {formatDateTime(d.uploaded_at)}</span>
                          {d.reviewed_at ? <span>· {d.review_status} by {one(d.staff_profiles)?.full_name ?? "staff"} {formatDate(d.reviewed_at)}{d.review_note ? `: ${d.review_note}` : ""}</span> : null}
                          {canWrite && d.review_status !== "accepted" ? (
                            <ActionForm action={reviewDocument} label="Accept" size="xs" variant="success">
                              {idField}<input type="hidden" name="documentId" value={d.id} /><input type="hidden" name="status" value="accepted" />
                            </ActionForm>
                          ) : null}
                          {canWrite && d.review_status !== "rejected" ? (
                            <ActionForm action={reviewDocument} label="Reject" size="xs" variant="ghost" className="flex items-center gap-2" confirm="Reject this document and email the parent to upload it again?">
                              {idField}<input type="hidden" name="documentId" value={d.id} /><input type="hidden" name="status" value="rejected" />
                              <Input name="note" placeholder="Why (sent to the parent)" className="h-7 w-56 md:h-7" required minLength={3} />
                            </ActionForm>
                          ) : null}
                          {canWrite && extractorOn && isExtractable(d.requirement_code) && d.extraction_status !== "pending" ? (
                            <ActionForm action={extractDocument} label={d.extraction_status === "done" ? "Read again" : "Read with AI"} size="xs" variant="ghost">
                              {idField}<input type="hidden" name="documentId" value={d.id} />
                            </ActionForm>
                          ) : null}
                        </div>
                      ) : null}
                      {d && isExtractable(d.requirement_code) ? <DocumentReading document={d} /> : null}
                    </li>
                  );
                })}
            </ul>
          </section>

          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Student</h2>
            {changed.length ? <p className="mt-1 rounded-md bg-warning/15 px-3 py-2 text-xs">The parent entered a different {changed.map((f) => f.replace("child_", "").replace(/_/g, " ")).join(", ")} from the application. Check against the birth certificate.</p> : null}
            {flags.length ? (
              <div className="mt-1 rounded-md bg-warning/15 px-3 py-2 text-xs">
                <p className="font-medium">A document disagrees with the form — nothing has been changed:</p>
                <ul className="mt-1 list-disc pl-4">
                  {flags.map((f) => <li key={`${f.document_id}-${f.field}`}>{f.label}: the {f.requirement_code.replace(/_/g, " ")} shows <strong>{f.document_value ?? "—"}</strong>; the form says <strong>{f.registration_value ?? "—"}</strong></li>)}
                </ul>
                {canWrite && app.status === "registration_incomplete" ? (
                  <ActionForm action={askParentToConfirm} label="Ask the parent to check" size="xs" variant="outline" className="mt-2">{idField}</ActionForm>
                ) : <p className="mt-1 text-muted-foreground">The parent can only correct the form while registration is open.</p>}
              </div>
            ) : null}
            <dl className="mt-2">
              <Row label="Legal name" value={[r?.legal_first_name, r?.legal_middle_names, r?.legal_last_name].filter(Boolean).join(" ")} />
              <Row label="Preferred name" value={r?.preferred_name} />
              <Row label="Gender" value={r?.gender} />
              <Row label="Date of birth" value={r?.date_of_birth ? `${formatDate(r.date_of_birth)} (application: ${formatDate(app.child_date_of_birth)})` : null} />
              <Row label="Nationality" value={r?.nationality} />
              <Row label="Born" value={[r?.place_of_birth, r?.country_of_birth].filter(Boolean).join(", ")} />
              <Row label="Home language" value={r?.home_language} />
              <Row label="Identity" value={r?.identity_number ? `${r.identity_type ?? ""} ${r.identity_number}`.trim() : null} />
              <Row label="Previous school" value={[r?.previous_institution, r?.current_grade].filter(Boolean).join(" — ")} />
            </dl>
          </section>

          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Medical</h2>
            <dl className="mt-2">
              <Row label="Medical aid" value={r?.medical_aid_name ? `${r.medical_aid_name} · ${r.medical_aid_number ?? ""} · principal ${r.medical_aid_principal_member ?? ""}` : "None"} />
              <Row label="Emergency treatment" value={r?.emergency_treatment_consent === null || r?.emergency_treatment_consent === undefined ? null : r.emergency_treatment_consent ? "School may authorise" : "Call a parent first"} />
              <Row label="Allergies" value={r?.allergies} />
              <Row label="Conditions" value={r?.medical_conditions} />
              <Row label="Medication" value={r?.medication} />
              <Row label="Vaccinations" value={r?.vaccination_notes} />
              <Row label="Notes" value={r?.medical_notes} />
            </dl>
          </section>

          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Family and emergency contacts</h2>
            <dl className="mt-2">
              {guardians.map((g) => <Row key={g.id} label={g.kind === "primary_guardian" ? "Primary guardian" : "Second guardian"} value={`${g.first_name} ${g.last_name} (${RELATIONSHIP_LABELS[g.relationship]})\n${[g.mobile, g.phone, g.email].filter(Boolean).join(" · ")}${g.address ? `\n${g.address}` : ""}${g.nationality ? `\n${g.nationality}` : ""}`} />)}
              {emergency.map((e) => <Row key={e.id} label={`Emergency ${e.position}`} value={`${e.first_name} ${e.last_name} (${RELATIONSHIP_LABELS[e.relationship]})\n${[e.phone, e.email].filter(Boolean).join(" · ")}${e.address ? `\n${e.address}` : ""}`} />)}
            </dl>
          </section>

          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Agreements</h2>
            <ul className="mt-2 text-sm">
              {(templates ?? []).map((t) => {
                const a = (acceptances ?? []).find((x) => x.agreement_template_id === t.id);
                return <li key={t.id} className="flex flex-wrap gap-2 py-1"><span className="font-medium">{t.name}</span>{a ? <span className="text-xs text-muted-foreground">v{a.template_version} · signed &ldquo;{a.signature_name}&rdquo; {formatDateTime(a.accepted_at)}</span> : <Badge variant={t.required ? "warning" : "secondary"}>{t.required ? "not accepted" : "optional, not accepted"}</Badge>}</li>;
              })}
            </ul>
          </section>
        </div>

        <aside className="space-y-5">
          <section className="rounded-xl border border-border bg-card p-4 text-sm">
            <h2 className="text-sm font-semibold">Completeness</h2>
            <ul className="mt-2 space-y-1">
              {SECTIONS.map((s) => <li key={s} className="flex justify-between"><span>{SECTION_LABELS[s]}</span><span className={c.sections[s] ? "text-success" : "text-warning-foreground"}>{c.sections[s] ? "done" : "to do"}</span></li>)}
            </ul>
            {r?.submitted_at ? <p className="mt-2 text-xs text-muted-foreground">Submitted {formatDateTime(r.submitted_at)}</p> : null}
            {canWrite && app.status === "registration_complete" ? (
              <div className="mt-3">
                <ActionForm action={confirmEnrolment} label="Confirm enrolment" variant="success" size="sm" confirm="Confirm enrolment and send the welcome email?">{idField}</ActionForm>
                {!c.complete ? <p className="mt-1 text-xs text-warning-foreground">Refused until every required document is in and accepted.</p> : null}
              </div>
            ) : null}
            {canWrite && app.status === "registration_incomplete" ? (
              <div className="mt-3">
                <ActionForm action={sendRegistrationReminder} label="Send reminder" variant="outline" size="sm">{idField}</ActionForm>
              </div>
            ) : null}
          </section>
          {record ? (
            <section className="rounded-xl border border-border bg-card p-4 text-sm">
              <h2 className="text-sm font-semibold">Student record</h2>
              <p className="mt-1 text-xs text-muted-foreground">Generated {formatDateTime(record.generated_at)} · export {record.export_status}{record.external_ref ? ` (${record.external_ref})` : ""}</p>
              {record.export_error ? <p className="mt-1 text-xs text-muted-foreground">{record.export_error}</p> : null}
              {can(permissions, "data.export") ? <p className="mt-2"><Link href={`/staff/registrations/${app.id}/record`} prefetch={false} className="font-medium text-primary underline underline-offset-2">Download as JSON</Link></p> : null}
            </section>
          ) : null}
        </aside>
      </div>
    </>
  );
}
