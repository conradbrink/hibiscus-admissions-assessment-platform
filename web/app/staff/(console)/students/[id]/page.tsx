import Link from "next/link";
import { notFound } from "next/navigation";
import { PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime } from "@/lib/format-date";
import {
  ENROLMENT_STATUS_LABELS,
  STUDENT_STATUS_LABELS,
  STUDENT_STATUS_TONE,
  studentLegalName,
  studentName,
} from "@/lib/students/labels";
import { requireStaff } from "@/lib/staff/session";
import type { EnrolmentStatus, StudentStatus } from "@/lib/supabase/types";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value && value.trim() ? value : <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

/**
 * One child's record. Read-only for now: the register comes first, and the
 * things that write to it — the onboarding checklist, the termly refresh —
 * arrive with the stages that own them.
 */
export default async function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await requireStaff("students.read");
  const { id } = await params;

  const { data: student } = await supabase
    .from("students")
    .select(
      "*, campuses!students_current_campus_id_fkey(name), grades!students_current_grade_id_fkey(name)"
    )
    .eq("id", id)
    .maybeSingle();
  // Not found and not yours read the same, on purpose: a foreign id must not
  // be distinguishable from a missing one.
  if (!student) notFound();

  const [{ data: family }, { data: enrolments }, { data: siblings }, { data: application }] = await Promise.all([
    supabase.from("families").select("id, family_code, display_name, home_address").eq("id", student.family_id).maybeSingle(),
    supabase
      .from("enrolments")
      .select("id, status, starts_on, ends_on, campuses(name), grades(name), academic_years(label), class_groups(name, teacher_name)")
      .eq("student_id", id)
      .order("starts_on", { ascending: false }),
    supabase
      .from("students")
      .select("id, legal_first_name, legal_last_name, preferred_name, status")
      .eq("family_id", student.family_id)
      .neq("id", id),
    student.origin_application_id
      ? supabase
          .from("applications")
          .select("id, reference, status")
          .eq("id", student.origin_application_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const { data: contacts } = family
    ? await supabase
        .from("contacts")
        .select("id, first_name, last_name, email, mobile, whatsapp_opt_in")
        .eq("family_id", family.id)
    : { data: [] };

  const status = student.status as StudentStatus;

  return (
    <>
      <PageTitle
        title={studentName(student)}
        description={`${student.student_code} · ${one(student.grades)?.name ?? "no grade"} · ${one(student.campuses)?.name ?? "no campus"}`}
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge variant={STUDENT_STATUS_TONE[status]}>{STUDENT_STATUS_LABELS[status]}</Badge>
        {student.details_confirmed_at ? (
          <span className="text-xs text-muted-foreground">
            Details confirmed {formatDate(student.details_confirmed_at)}
          </span>
        ) : (
          <Badge variant="warning">Details never confirmed</Badge>
        )}
        {application ? (
          <Link href={`/staff/applications/${application.id}`} className="text-xs underline">
            Arrived on {application.reference}
          </Link>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="surface p-4">
          <h2 className="mb-3 text-sm font-semibold">The child</h2>
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Legal name" value={studentLegalName(student)} />
            <Field label="Known as" value={student.preferred_name} />
            <Field label="Date of birth" value={formatDate(student.date_of_birth)} />
            <Field label="Gender" value={student.gender} />
            <Field label="Nationality" value={student.nationality} />
            <Field label="Home language" value={student.home_language} />
            <Field label="Identity" value={student.identity_number ? `${student.identity_type ?? "document"} ${student.identity_number}` : null} />
            <Field label="Country of birth" value={student.country_of_birth} />
          </dl>
        </section>

        <section className="surface p-4">
          <h2 className="mb-3 text-sm font-semibold">Medical</h2>
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Medical aid" value={student.medical_aid_name} />
            <Field label="Membership number" value={student.medical_aid_number} />
            <Field label="Principal member" value={student.medical_aid_principal_member} />
            <Field
              label="Emergency treatment"
              value={student.emergency_treatment_consent === null ? null : student.emergency_treatment_consent ? "Consented" : "Not consented"}
            />
            <Field label="Allergies" value={student.allergies} />
            <Field label="Conditions" value={student.medical_conditions} />
            <Field label="Medication" value={student.medication} />
            <Field label="Vaccinations" value={student.vaccination_notes} />
          </dl>
          {student.medical_notes ? (
            <p className="mt-3 text-sm">{student.medical_notes}</p>
          ) : null}
        </section>

        <section className="surface p-4">
          <h2 className="mb-3 text-sm font-semibold">The family</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            {family?.family_code ?? "no code"}
            {family?.display_name ? ` · ${family.display_name}` : ""}
          </p>
          {(contacts ?? []).length ? (
            <ul className="mb-3 space-y-2">
              {(contacts ?? []).map((c) => (
                <li key={c.id} className="text-sm">
                  <span className="font-medium">{c.first_name} {c.last_name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {c.email}
                    {c.mobile ? ` · ${c.mobile}` : ""}
                    {c.whatsapp_opt_in ? " · WhatsApp" : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-sm text-muted-foreground">No contacts on this family.</p>
          )}
          <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Brothers and sisters</h3>
          {(siblings ?? []).length ? (
            <ul className="space-y-1">
              {(siblings ?? []).map((s) => (
                <li key={s.id} className="text-sm">
                  <Link href={`/staff/students/${s.id}`} className="hover:underline">{studentName(s)}</Link>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {STUDENT_STATUS_LABELS[s.status as StudentStatus]}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">None enrolled.</p>
          )}
        </section>

        <section className="surface p-4">
          <h2 className="mb-3 text-sm font-semibold">Years at the school</h2>
          {(enrolments ?? []).length ? (
            <table className="data-table">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Year</th>
                  <th className="py-1 font-medium">Campus and grade</th>
                  <th className="py-1 font-medium">Class</th>
                  <th className="py-1 font-medium">Starts</th>
                  <th className="py-1 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(enrolments ?? []).map((e) => (
                  <tr key={e.id}>
                    <td className="py-1 text-sm">{one(e.academic_years)?.label ?? "—"}</td>
                    <td className="py-1 text-sm">
                      {one(e.campuses)?.name ?? "—"} · {one(e.grades)?.name ?? "—"}
                    </td>
                    <td className="py-1 text-sm">
                      {one(e.class_groups)?.name ?? <span className="text-muted-foreground">not allocated</span>}
                    </td>
                    <td className="py-1 text-xs">{e.starts_on ? formatDate(e.starts_on) : "—"}</td>
                    <td className="py-1 text-xs">{ENROLMENT_STATUS_LABELS[e.status as EnrolmentStatus]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">No enrolment recorded.</p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Added to the register {formatDateTime(student.created_at)}.
          </p>
        </section>
      </div>
    </>
  );
}
