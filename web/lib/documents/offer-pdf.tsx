import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { FeeSnapshot } from "@/lib/offers/snapshot";
import { formatMoney } from "@/lib/money";

/**
 * The offer as a PDF, from the snapshot. react-pdf does not render HTML,
 * so the layout is fixed here and the template's prose is included as
 * plain text with tags stripped; the parent's web view shows the HTML.
 */

const s = StyleSheet.create({
  page: { padding: 44, fontSize: 11, fontFamily: "Helvetica", color: "#1f2937", lineHeight: 1.45 },
  brand: { fontSize: 10, color: "#f26a2e", fontFamily: "Helvetica-Bold", letterSpacing: 1 },
  title: { fontSize: 22, fontFamily: "Helvetica-Bold", marginTop: 6, marginBottom: 12 },
  h2: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 16, marginBottom: 6 },
  para: { marginBottom: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb" },
  bold: { fontFamily: "Helvetica-Bold" },
  small: { fontSize: 9, color: "#6b7280" },
  footer: { position: "absolute", bottom: 28, left: 44, right: 44, fontSize: 8, color: "#9ca3af" },
});

export function htmlToParagraphs(html: string): string[] {
  return html
    .replace(/<\/(p|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export type OfferDocumentProps = {
  studentName: string;
  reference: string;
  bodyHtml: string;
  termsHtml: string;
  fees: FeeSnapshot | null;
  expiresOn: string | null;
  sentOn: string | null;
};

export function OfferDocument(p: OfferDocumentProps) {
  return (
    <Document title={`${p.studentName} — Hibiscus offer of admission`} author="Hibiscus Schools">
      <Page size="A4" style={s.page}>
        <Text style={s.brand}>HIBISCUS SCHOOLS</Text>
        <Text style={s.title}>Offer of Admission</Text>
        <Text style={s.small}>Reference {p.reference}{p.sentOn ? ` · issued ${p.sentOn}` : ""}{p.expiresOn ? ` · open until ${p.expiresOn}` : ""}</Text>
        <View style={{ marginTop: 12 }}>
          {htmlToParagraphs(p.bodyHtml).map((line, i) => (
            <Text key={i} style={s.para}>{line}</Text>
          ))}
        </View>
        {p.fees ? (
          <>
            <Text style={s.h2}>Fees ({p.fees.currency})</Text>
            {p.fees.lines.map((l) => (
              <View key={l.code} style={s.row}><Text>{l.label}{l.payable_at_acceptance ? " (payable on acceptance)" : ""}</Text><Text>{formatMoney(l.amount_minor, p.fees!.currency)}</Text></View>
            ))}
            <View style={s.row}><Text style={s.bold}>Payable on acceptance</Text><Text style={s.bold}>{formatMoney(p.fees.payable_at_acceptance_minor, p.fees.currency)}</Text></View>
          </>
        ) : null}
        <Text style={s.h2}>Terms</Text>
        {htmlToParagraphs(p.termsHtml).map((line, i) => (
          <Text key={i} style={{ ...s.para, fontSize: 10 }}>{line}</Text>
        ))}
        <Text style={s.footer} fixed>Hibiscus Schools · Admissions · This document was generated from the offer template in force on the date of issue.</Text>
      </Page>
    </Document>
  );
}
