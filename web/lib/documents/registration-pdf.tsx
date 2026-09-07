import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { LetterFoot, Letterhead, SCHOOL_NAME, type LetterheadCampus } from "@/lib/documents/letterhead";

/**
 * The registration record as a PDF: everything the family gave at
 * registration, the documents received, and the agreements signed, in
 * the order the form asked. Takes plain values as props and touches no
 * database. Medical details are included: this is the school's own
 * record, downloaded by staff who may read the registration.
 */

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 56, paddingHorizontal: 44, fontSize: 10.5, fontFamily: "Helvetica", color: "#1f2937" },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", marginTop: 4, lineHeight: 1.2 },
  subtitle: { fontSize: 10.5, color: "#6b7280", marginTop: 2 },
  h2: { fontSize: 12.5, fontFamily: "Helvetica-Bold", marginTop: 16, marginBottom: 5, color: "#111827" },
  h3: { fontSize: 10.5, fontFamily: "Helvetica-Bold", marginTop: 8, marginBottom: 3 },
  row: { flexDirection: "row", paddingVertical: 2.5, borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb" },
  label: { width: 170, color: "#6b7280" },
  value: { flex: 1 },
  note: { fontSize: 9, color: "#6b7280", marginTop: 4, lineHeight: 1.35 },
});

export type Field = { label: string; value: string | null | undefined };
export type Section = { heading: string; subheading?: string; fields: Field[] };

export type RegistrationDocumentProps = {
  logoUrl: string | null;
  letterhead: LetterheadCampus | null;
  studentName: string;
  gradeName: string;
  campusName: string;
  intakeLabel: string;
  reference: string;
  status: string;
  submittedOn: string | null;
  printedOn: string;
  sections: Section[];
  documents: Array<{ label: string; status: string; filename: string | null; uploadedOn: string | null }>;
  agreements: Array<{ name: string; version: number; acceptedOn: string; signedBy: string }>;
};

function Rows({ fields }: { fields: Field[] }) {
  return (
    <>
      {fields.map((f) => (
        <View key={f.label} style={s.row} wrap={false}>
          <Text style={s.label}>{f.label}</Text>
          <Text style={s.value}>{f.value && String(f.value).trim() ? String(f.value) : "—"}</Text>
        </View>
      ))}
    </>
  );
}

export function RegistrationDocument(p: RegistrationDocumentProps) {
  return (
    <Document title={`${p.studentName} — ${SCHOOL_NAME} registration record`} author={SCHOOL_NAME}>
      <Page size="A4" style={s.page}>
        <Letterhead logoUrl={p.logoUrl} campus={p.letterhead} lines={["Registration record", p.reference]} />
        <Text style={s.title}>{p.studentName}</Text>
        <Text style={s.subtitle}>Registration record · {p.gradeName}, {p.campusName}, {p.intakeLabel} · {p.reference}</Text>
        <Text style={s.subtitle}>Status: {p.status.replace(/_/g, " ")}{p.submittedOn ? ` · submitted ${p.submittedOn}` : " · not yet submitted"} · printed {p.printedOn}</Text>

        {p.sections.map((sec) => (
          <View key={sec.heading}>
            <Text style={s.h2}>{sec.heading}</Text>
            {sec.subheading ? <Text style={s.h3}>{sec.subheading}</Text> : null}
            <Rows fields={sec.fields} />
          </View>
        ))}

        <Text style={s.h2}>Documents</Text>
        {p.documents.length ? (
          p.documents.map((d) => (
            <View key={d.label} style={s.row} wrap={false}>
              <Text style={s.label}>{d.label}</Text>
              <Text style={s.value}>{d.status}{d.filename ? ` · ${d.filename}` : ""}{d.uploadedOn ? ` · ${d.uploadedOn}` : ""}</Text>
            </View>
          ))
        ) : (
          <Text style={s.note}>No documents apply.</Text>
        )}

        <Text style={s.h2}>Agreements</Text>
        {p.agreements.length ? (
          p.agreements.map((a) => (
            <View key={`${a.name}-${a.version}`} style={s.row} wrap={false}>
              <Text style={s.label}>{a.name} (v{a.version})</Text>
              <Text style={s.value}>Accepted {a.acceptedOn} · signed {a.signedBy}</Text>
            </View>
          ))
        ) : (
          <Text style={s.note}>No agreements accepted yet.</Text>
        )}
        <Text style={s.note}>The signed agreements, with the wording accepted and the signature drawn, are a separate document.</Text>

        <LetterFoot text="Registration record. Personal and medical information for the school's use only; handle under the school's data protection policy." />
      </Page>
    </Document>
  );
}
