import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { BAND_LABELS } from "@/lib/assessment/bands";
import type { ComputedProfile } from "@/lib/profile/compute";
import type { Narrative } from "@/lib/profile/narrative";

/**
 * The learning profile as a PDF. Takes the snapshot as props and touches no
 * database, so it renders the same in a test as in a route handler.
 */

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 11, fontFamily: "Helvetica", color: "#1f2937" },
  brand: { fontSize: 10, color: "#f26a2e", fontFamily: "Helvetica-Bold", letterSpacing: 1 },
  title: { fontSize: 22, fontFamily: "Helvetica-Bold", marginTop: 6 },
  subtitle: { fontSize: 11, color: "#6b7280", marginTop: 2 },
  h2: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 18, marginBottom: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb" },
  cell: { fontSize: 11 },
  muted: { color: "#6b7280" },
  para: { lineHeight: 1.45, marginBottom: 6 },
  big: { fontSize: 30, fontFamily: "Helvetica-Bold" },
  footer: { position: "absolute", bottom: 28, left: 40, right: 40, fontSize: 8, color: "#9ca3af", lineHeight: 1.3 },
});

export type ProfileDocumentProps = {
  studentName: string;
  gradeName: string;
  campusName: string;
  reference: string;
  generatedOn: string;
  computed: ComputedProfile;
  narrative: Narrative;
};

export function ProfileDocument(p: ProfileDocumentProps) {
  return (
    <Document title={`${p.studentName} — Hibiscus learning profile`} author="Hibiscus Schools">
      <Page size="A4" style={s.page}>
        <Text style={s.brand}>HIBISCUS SCHOOLS</Text>
        <Text style={s.title}>{p.studentName}</Text>
        <Text style={s.subtitle}>Learning profile · {p.gradeName}, {p.campusName} · {p.reference} · {p.generatedOn}</Text>

        {p.computed.overall ? (
          <View style={{ marginTop: 16, flexDirection: "row", alignItems: "flex-end" }}>
            <Text style={s.big}>{p.computed.overall.percent}%</Text>
            <Text style={{ marginLeft: 10, marginBottom: 6, ...s.muted }}>Overall · {BAND_LABELS[p.computed.overall.band]}</Text>
          </View>
        ) : null}

        <Text style={s.h2}>Summary</Text>
        <Text style={s.para}>{p.narrative.summary}</Text>

        {p.computed.strengths.length ? (
          <>
            <Text style={s.h2}>Strengths</Text>
            {p.computed.strengths.map((x) => (
              <View key={x.id} style={s.row}><Text style={s.cell}>{x.name}</Text><Text style={s.cell}>{x.percent}%</Text></View>
            ))}
            {p.narrative.strengths_text ? <Text style={{ ...s.para, marginTop: 6 }}>{p.narrative.strengths_text}</Text> : null}
          </>
        ) : null}

        {p.computed.development.length ? (
          <>
            <Text style={s.h2}>Areas for development</Text>
            {p.computed.development.map((x) => (
              <View key={x.id} style={s.row}><Text style={s.cell}>{x.name}</Text><Text style={s.cell}>{x.percent}%</Text></View>
            ))}
            {p.narrative.development_text ? <Text style={{ ...s.para, marginTop: 6 }}>{p.narrative.development_text}</Text> : null}
            {p.computed.focus.length ? (
              <>
                <Text style={{ ...s.h2, fontSize: 11 }}>Recommended focus</Text>
                {p.computed.focus.map((f, i) => <Text key={i} style={s.para}>{i + 1}. {f}</Text>)}
              </>
            ) : null}
          </>
        ) : null}

        <Text style={s.h2}>All results</Text>
        {p.computed.subjects.map((x) => (
          <View key={x.id}>
            <View style={s.row}><Text style={{ ...s.cell, fontFamily: "Helvetica-Bold" }}>{x.name}</Text><Text style={{ ...s.cell, fontFamily: "Helvetica-Bold" }}>{x.percent}% · {BAND_LABELS[x.band]}</Text></View>
          </View>
        ))}
        {p.computed.competencies.map((x) => (
          <View key={x.id} style={s.row}><Text style={{ ...s.cell, marginLeft: 12 }}>{x.name}</Text><Text style={s.cell}>{x.percent}% · {BAND_LABELS[x.band]}</Text></View>
        ))}

        <Text style={s.footer} fixed>
          This profile summarises an academic assessment of English, Mathematics and reasoning skills on one day. It is not a psychological, clinical or diagnostic assessment and makes no claim about ability, intelligence or any condition. Percentages are marks earned out of marks available; bands describe how a result compares with what the school expects for the grade applied for.
        </Text>
      </Page>
    </Document>
  );
}
