import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { LetterFoot, Letterhead, SCHOOL_NAME } from "@/lib/documents/letterhead";
import type { FeeSnapshot } from "@/lib/offers/snapshot";
import { formatMoney } from "@/lib/money";

/**
 * The offer as a PDF, from the snapshot. react-pdf does not render HTML,
 * so the layout is fixed here and the template's prose is included as
 * plain text with tags stripped; the parent's web view shows the HTML.
 */

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 56, paddingHorizontal: 44, fontSize: 11, fontFamily: "Helvetica", color: "#1f2937", lineHeight: 1.45 },
  title: { fontSize: 22, fontFamily: "Helvetica-Bold", marginTop: 4, marginBottom: 12, lineHeight: 1.2 },
  h2: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 16, marginBottom: 6 },
  para: { marginBottom: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb" },
  bold: { fontFamily: "Helvetica-Bold" },
  small: { fontSize: 9, color: "#6b7280" },
});

export function htmlToParagraphs(html: string, opts: { dropLeadingHeading?: string } = {}): string[] {
  const lines = html
    .replace(/<\/(p|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(strong|em|b|i|u|a|span)\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim())
    .filter(Boolean);
  // The template may open with the same heading the page already prints.
  const heading = opts.dropLeadingHeading?.trim().toLowerCase();
  return heading && lines[0]?.toLowerCase() === heading ? lines.slice(1) : lines;
}

export type OfferDocumentProps = {
  logoUrl: string | null;
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
    <Document title={`${p.studentName} — ${SCHOOL_NAME} offer of admission`} author={SCHOOL_NAME}>
      <Page size="A4" style={s.page}>
        <Letterhead logoUrl={p.logoUrl} lines={["Offer of admission", `Reference ${p.reference}`]} />
        <Text style={s.title}>Offer of Admission</Text>
        <Text style={s.small}>{p.sentOn ? `Issued ${p.sentOn}` : "Draft"}{p.expiresOn ? ` · open until ${p.expiresOn}` : ""}</Text>
        <View style={{ marginTop: 12 }}>
          {htmlToParagraphs(p.bodyHtml, { dropLeadingHeading: "Offer of Admission" }).map((line, i) => (
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
        {htmlToParagraphs(p.termsHtml, { dropLeadingHeading: "Terms" }).map((line, i) => (
          <Text key={i} style={{ ...s.para, fontSize: 10 }}>{line}</Text>
        ))}
        <LetterFoot text="Admissions · Generated from the offer template in force on the date of issue." />
      </Page>
    </Document>
  );
}
