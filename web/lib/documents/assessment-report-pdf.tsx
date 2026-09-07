import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { BAND_LABELS } from "@/lib/assessment/bands";
import { LetterFoot, Letterhead, SCHOOL_NAME } from "@/lib/documents/letterhead";
import type { ComputedProfile } from "@/lib/profile/compute";
import type { Narrative } from "@/lib/profile/narrative";

/**
 * The assessment report an assessor prints and talks a parent through: the
 * learning profile (numbers computed by code, prose behind the validator),
 * every result by subject and skill, and room at the end for the assessor's
 * own comments and a signature. Takes a snapshot as props and touches no
 * database.
 */

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 56, paddingHorizontal: 44, fontSize: 10.5, fontFamily: "Helvetica", color: "#1f2937", lineHeight: 1.4 },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", lineHeight: 1.2 },
  subtitle: { fontSize: 10.5, color: "#6b7280", marginTop: 3 },
  h2: { fontSize: 12.5, fontFamily: "Helvetica-Bold", marginTop: 16, marginBottom: 6, color: "#111827" },
  h3: { fontSize: 10.5, fontFamily: "Helvetica-Bold", marginTop: 8, marginBottom: 2 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb" },
  rowBold: { fontFamily: "Helvetica-Bold" },
  muted: { color: "#6b7280" },
  para: { marginBottom: 6 },
  big: { fontSize: 28, fontFamily: "Helvetica-Bold", lineHeight: 1.15 },
  bandBox: { flexDirection: "row", gap: 8, marginTop: 10, marginBottom: 4 },
  pill: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 6, paddingVertical: 5, paddingHorizontal: 9, flexGrow: 1 },
  pillLabel: { fontSize: 8.5, color: "#6b7280" },
  pillValue: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 1 },
  lines: { marginTop: 6 },
  line: { borderBottomWidth: 0.6, borderBottomColor: "#9ca3af", height: 20 },
  sign: { flexDirection: "row", justifyContent: "space-between", marginTop: 22 },
  signCell: { width: "45%", borderTopWidth: 0.8, borderTopColor: "#1f2937", paddingTop: 4, fontSize: 9, color: "#6b7280" },
});

export type AssessmentReportProps = {
  logoUrl: string | null;
  studentName: string;
  firstName: string;
  gradeName: string;
  campusName: string;
  reference: string;
  assessedOn: string;
  printedOn: string;
  computed: ComputedProfile;
  narrative: Narrative;
};

function pct(n: number): string {
  return `${Number.isInteger(n) ? n : Math.round(n * 10) / 10}%`;
}

export function AssessmentReportDocument(p: AssessmentReportProps) {
  const subjectOf = (id?: string) => p.computed.subjects.find((x) => x.id === id)?.name ?? "";
  // When nothing fell below the expectation, the two lowest results that were
  // not full marks still tell a parent where the next gains are. Numbers only;
  // the same lines appear under "All results".
  const roomToGrow = p.computed.development.length
    ? []
    : [...p.computed.competencies].filter((c) => c.percent < 100).sort((a, b) => a.percent - b.percent).slice(0, 2);
  return (
    <Document title={`${p.studentName} — ${SCHOOL_NAME} assessment report`} author={SCHOOL_NAME}>
      <Page size="A4" style={s.page}>
        <Letterhead logoUrl={p.logoUrl} lines={["Admissions assessment report", `${p.reference} · printed ${p.printedOn}`]} />

        <Text style={s.title}>{p.studentName}</Text>
        <Text style={s.subtitle}>Applying for {p.gradeName} at {p.campusName} · assessed {p.assessedOn}</Text>

        {p.computed.overall ? (
          <View style={{ marginTop: 14, flexDirection: "row", alignItems: "baseline" }}>
            <Text style={s.big}>{pct(p.computed.overall.percent)}</Text>
            <Text style={{ marginLeft: 10, ...s.muted }}>overall · {BAND_LABELS[p.computed.overall.band]} the expectation for {p.gradeName}</Text>
          </View>
        ) : null}
        {p.computed.subjects.length ? (
          <View style={s.bandBox}>
            {p.computed.subjects.map((x) => (
              <View key={x.id} style={s.pill}>
                <Text style={s.pillLabel}>{x.name}</Text>
                <Text style={s.pillValue}>{pct(x.percent)} · {BAND_LABELS[x.band]}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <Text style={s.h2}>In summary</Text>
        <Text style={s.para}>{p.narrative.summary}</Text>

        {p.computed.strengths.length ? (
          <>
            <Text style={s.h2}>Where {p.firstName} did well</Text>
            {p.narrative.strengths_text ? <Text style={s.para}>{p.narrative.strengths_text}</Text> : null}
            {p.computed.strengths.map((x) => (
              <View key={x.id} style={s.row}>
                <Text>{x.name}{subjectOf(x.subjectId) ? ` (${subjectOf(x.subjectId)})` : ""}</Text>
                <Text style={s.rowBold}>{pct(x.percent)} · {BAND_LABELS[x.band]}</Text>
              </View>
            ))}
          </>
        ) : null}

        {p.computed.development.length ? (
          <>
            <Text style={s.h2}>Where practice would help most</Text>
            {p.narrative.development_text ? <Text style={s.para}>{p.narrative.development_text}</Text> : null}
            {p.computed.development.map((x) => (
              <View key={x.id} style={s.row}>
                <Text>{x.name}{subjectOf(x.subjectId) ? ` (${subjectOf(x.subjectId)})` : ""}</Text>
                <Text style={s.rowBold}>{pct(x.percent)} · {BAND_LABELS[x.band]}</Text>
              </View>
            ))}
            {p.computed.focus.length ? (
              <>
                <Text style={s.h3}>Suggested focus at home and at school</Text>
                {p.computed.focus.map((f, i) => (
                  <Text key={i} style={s.para}>{i + 1}. {f}</Text>
                ))}
              </>
            ) : null}
          </>
        ) : (
          <>
            <Text style={s.h2}>Where practice would help most</Text>
            <Text style={s.para}>{p.narrative.development_text || "No area stood out as needing particular attention on the day."}</Text>
            {roomToGrow.length ? (
              <>
                <Text style={{ ...s.para, ...s.muted }}>The areas with the most room to grow on the day, even so:</Text>
                {roomToGrow.map((x) => (
                  <View key={x.id} style={s.row}>
                    <Text>{x.name}{subjectOf(x.subjectId) ? ` (${subjectOf(x.subjectId)})` : ""}</Text>
                    <Text style={s.rowBold}>{pct(x.percent)} · {BAND_LABELS[x.band]}</Text>
                  </View>
                ))}
              </>
            ) : null}
          </>
        )}

        <View wrap={false}>
          <Text style={s.h2}>All results</Text>
          {p.computed.subjects.map((x) => (
            <View key={x.id}>
              <View style={s.row}>
                <Text style={s.rowBold}>{x.name}</Text>
                <Text style={s.rowBold}>{pct(x.percent)} · {BAND_LABELS[x.band]}</Text>
              </View>
              {p.computed.competencies.filter((c) => c.subjectId === x.id).map((c) => (
                <View key={c.id} style={s.row}>
                  <Text style={{ marginLeft: 12 }}>{c.name}</Text>
                  <Text>{pct(c.percent)} · {BAND_LABELS[c.band]}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>

        <View wrap={false}>
          <Text style={s.h2}>Assessor&apos;s comments</Text>
          <View style={s.lines}>
            <View style={s.line} /><View style={s.line} /><View style={s.line} /><View style={s.line} />
          </View>
          <View style={s.sign}>
            <View style={s.signCell}><Text>Assessor</Text></View>
            <View style={s.signCell}><Text>Discussed with parent on</Text></View>
          </View>
        </View>

        <LetterFoot text={"This report summarises an academic assessment of English and Mathematics skills on one day. It is not a psychological, clinical or diagnostic assessment and makes no claim about ability, intelligence or any condition. Percentages are marks earned out of marks available; bands describe how a result compares with what the school expects for the grade applied for. It is not an admission decision."} />
      </Page>
    </Document>
  );
}
