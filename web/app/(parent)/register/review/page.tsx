import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { RegisterShell } from "@/components/parent/register/shell";
import { SubmitButton } from "@/components/parent/register/submit-button";
import { formatDate, formatDateLong } from "@/lib/format-date";
import { SECTION_LABELS, SECTIONS, missingDocumentsText } from "@/lib/registration/completeness";
import { RELATIONSHIP_LABELS } from "@/lib/registration/schema";
import { registrationForSession } from "@/lib/registration/session";
import { submitRegistration } from "../actions";

export const metadata: Metadata = { title: "Registration — review" };

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value || "—"}</dd>
    </div>
  );
}

export default async function ReviewStep() {
  const { graph, bundle, editable } = await registrationForSession();
  const r = bundle.registration;
  const c = bundle.completeness;
  const missing = missingDocumentsText(c);
  const guardians = bundle.contacts.filter((x) => x.kind !== "emergency");
  const emergency = bundle.contacts.filter((x) => x.kind === "emergency");

  return (
    <RegisterShell step="review" title={editable ? "Check and submit" : "Your registration"} description={editable ? "Everything below is what the school will hold. Change anything by opening its step." : r?.submitted_at ? `Submitted ${formatDateLong(r.submitted_at)}.` : undefined} readOnly={!editable}>
      <ul className="mb-5 grid gap-2 sm:grid-cols-2">
        {SECTIONS.map((s) => (
          <li key={s} className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm">
            {c.sections[s] ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <Circle className="size-4 text-warning-foreground" aria-hidden />}
            <Link href={`/register/${s}`} className="font-medium underline-offset-2 hover:underline">{SECTION_LABELS[s]}</Link>
            {!c.sections[s] ? <span className="ml-auto text-xs text-warning-foreground">to do</span> : null}
          </li>
        ))}
      </ul>
      {missing ? <p className="mb-5 rounded-2xl bg-warning/20 p-4 text-sm">Documents still needed: <strong>{missing}</strong>. You can submit now and add them later, but enrolment is confirmed only once they are in.</p> : null}

      <section className="space-y-4 text-sm">
        <dl className="rounded-2xl border border-border bg-card p-4">
          <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Student</p>
          <Row label="Legal name" value={[r?.legal_first_name, r?.legal_middle_names, r?.legal_last_name].filter(Boolean).join(" ")} />
          <Row label="Preferred name" value={r?.preferred_name} />
          <Row label="Date of birth" value={r?.date_of_birth ? formatDate(r.date_of_birth) : null} />
          <Row label="Nationality" value={r?.nationality} />
          <Row label="Home language" value={r?.home_language} />
          <Row label="Identity" value={r?.identity_number ? `${r.identity_type ?? ""} ${r.identity_number}`.trim() : null} />
          <Row label="Place" value={`${graph.grade.name}, ${graph.campus.name}, ${graph.intake.label}`} />
        </dl>
        <dl className="rounded-2xl border border-border bg-card p-4">
          <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Medical</p>
          <Row label="Medical aid" value={r?.medical_aid_name ? `${r.medical_aid_name} ${r.medical_aid_number ?? ""}`.trim() : "None"} />
          <Row label="Emergency treatment" value={r?.emergency_treatment_consent === null || r?.emergency_treatment_consent === undefined ? null : r.emergency_treatment_consent ? "May be authorised by the school" : "Call a parent first"} />
          <Row label="Allergies" value={r?.allergies} />
          <Row label="Conditions" value={r?.medical_conditions} />
          <Row label="Medication" value={r?.medication} />
        </dl>
        <dl className="rounded-2xl border border-border bg-card p-4">
          <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Family and emergency contacts</p>
          {guardians.map((g) => <Row key={g.id} label={g.kind === "primary_guardian" ? "Primary" : "Second guardian"} value={`${g.first_name} ${g.last_name} (${RELATIONSHIP_LABELS[g.relationship]}) · ${g.mobile ?? g.phone ?? ""} · ${g.email ?? ""}`} />)}
          {emergency.map((e) => <Row key={e.id} label="Emergency" value={`${e.first_name} ${e.last_name} (${RELATIONSHIP_LABELS[e.relationship]}) · ${e.phone ?? ""}`} />)}
        </dl>
      </section>

      {editable ? (
        <div className="mt-6">
          <SubmitButton action={submitRegistration} label="Submit registration" pendingLabel="Submitting…" />
        </div>
      ) : null}
    </RegisterShell>
  );
}
