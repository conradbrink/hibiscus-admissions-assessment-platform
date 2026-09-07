import { Document, Page, Path, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import { LetterFoot, Letterhead, SCHOOL_NAME, type LetterheadCampus } from "@/lib/documents/letterhead";
import { htmlToParagraphs } from "@/lib/documents/offer-pdf";
import { SIGNATURE_HEIGHT, SIGNATURE_WIDTH } from "@/lib/registration/signature";

/**
 * The agreements a parent signed, as a PDF: for each one, the wording in
 * the version they accepted, then who signed, when, and the signature as
 * drawn. The signature is redrawn from the stored path, never from
 * markup. Pure; no database.
 */

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 56, paddingHorizontal: 44, fontSize: 10.5, fontFamily: "Helvetica", color: "#1f2937" },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", marginTop: 4, lineHeight: 1.2 },
  subtitle: { fontSize: 10.5, color: "#6b7280", marginTop: 2 },
  h2: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 18, marginBottom: 6, color: "#111827" },
  para: { lineHeight: 1.45, marginBottom: 5 },
  sign: { marginTop: 10, padding: 10, borderWidth: 0.5, borderColor: "#d1d5db", borderRadius: 4 },
  signMeta: { fontSize: 9.5, color: "#6b7280", lineHeight: 1.4 },
  hash: { fontSize: 8, color: "#9ca3af", marginTop: 2 },
});

export type SignedAgreement = {
  name: string;
  version: number;
  bodyHtml: string;
  signatureName: string;
  /** The `d` attribute of the stored signature path, or null. */
  signaturePath: string | null;
  acceptedOn: string;
  bodyHash: string;
};

export type AgreementsDocumentProps = {
  logoUrl: string | null;
  letterhead: LetterheadCampus | null;
  studentName: string;
  reference: string;
  printedOn: string;
  agreements: SignedAgreement[];
};

/** The path data inside a stored signature SVG, if it is the shape we write. */
export function signaturePathFrom(svg: string | null | undefined): string | null {
  const m = (svg ?? "").match(/<path d="([^"]+)"/);
  return m ? m[1] : null;
}

export function AgreementsDocument(p: AgreementsDocumentProps) {
  return (
    <Document title={`${p.studentName} — ${SCHOOL_NAME} signed agreements`} author={SCHOOL_NAME}>
      <Page size="A4" style={s.page}>
        <Letterhead logoUrl={p.logoUrl} campus={p.letterhead} lines={["Signed agreements", p.reference]} />
        <Text style={s.title}>{p.studentName}</Text>
        <Text style={s.subtitle}>Agreements accepted at registration · {p.reference} · printed {p.printedOn}</Text>

        {p.agreements.map((a) => (
          <View key={`${a.name}-${a.version}`}>
            <Text style={s.h2} break={p.agreements.indexOf(a) > 0}>{a.name} (version {a.version})</Text>
            {htmlToParagraphs(a.bodyHtml).map((line, i) => (
              <Text key={i} style={s.para}>{line}</Text>
            ))}
            <View style={s.sign} wrap={false}>
              <Text style={s.signMeta}>Accepted by {a.signatureName} on {a.acceptedOn}.</Text>
              {a.signaturePath ? (
                <Svg viewBox={`0 0 ${SIGNATURE_WIDTH} ${SIGNATURE_HEIGHT}`} style={{ width: 240, height: 80, marginTop: 4 }}>
                  <Path d={a.signaturePath} fill="none" stroke="#1a1a1a" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              ) : (
                <Text style={s.signMeta}>Signed by typing the name.</Text>
              )}
              <Text style={s.hash}>Wording fingerprint {a.bodyHash.slice(0, 16)}: matches the text above as stored when it was accepted.</Text>
            </View>
          </View>
        ))}

        <LetterFoot text="Signed agreements. The wording shown is the version the parent accepted; the fingerprint ties it to the school's stored copy." />
      </Page>
    </Document>
  );
}
