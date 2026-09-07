import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { LetterFoot, Letterhead, SCHOOL_NAME, type LetterheadCampus } from "@/lib/documents/letterhead";
import type { FeeSnapshot } from "@/lib/offers/snapshot";
import { formatMoney } from "@/lib/money";

/**
 * The offer as a PDF, from the snapshot. react-pdf does not render HTML,
 * so the layout is fixed here and the template's prose is included as
 * plain text with tags stripped; the parent's web view shows the HTML.
 */

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 56, paddingHorizontal: 44, fontSize: 11, fontFamily: "Helvetica", color: "#1f2937", lineHeight: 1.45 },
  heading: { fontFamily: "Helvetica-Bold", fontSize: 12, marginTop: 4, marginBottom: 6 },
  h2: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 16, marginBottom: 6 },
  para: { marginBottom: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb" },
  bold: { fontFamily: "Helvetica-Bold" },
  small: { fontSize: 9, color: "#6b7280" },
});

export type OfferBlock = { kind: "heading" | "para" | "fees"; text: string };

/**
 * The template's HTML as blocks the PDF can lay out: a heading (h1 to h3,
 * or a paragraph wholly in bold), a paragraph, or the place the letter's
 * fee table stood, where the PDF prints the same figures from the
 * snapshot. Inline tags vanish without leaving a space before punctuation.
 */
export function htmlToBlocks(html: string, opts: { dropLeadingHeading?: string } = {}): OfferBlock[] {
  const FEES = "\u0000fees\u0000";
  const marked = html
    .replace(/<table\b[\s\S]*?<\/table>/gi, `\n${FEES}\n`)
    .replace(/<(h[1-3])\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => `\n\u0000h\u0000${inner}\n`)
    .replace(/<p\b[^>]*>\s*<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>\s*<\/p>/gi, (_m, _t, inner: string) => `\n\u0000h\u0000${inner}\n`)
    .replace(/<\/(p|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(strong|em|b|i|u|a|span)\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
  const blocks: OfferBlock[] = [];
  for (const raw of marked.split("\n")) {
    const line = raw.replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
    if (!line) continue;
    if (line === FEES) blocks.push({ kind: "fees", text: "" });
    else if (line.startsWith("\u0000h\u0000")) blocks.push({ kind: "heading", text: line.slice(3).trim() });
    else blocks.push({ kind: "para", text: line });
  }
  // The template may open with the same heading the page already prints.
  const heading = opts.dropLeadingHeading?.trim().toLowerCase();
  return heading && blocks[0]?.kind === "heading" && blocks[0].text.toLowerCase() === heading ? blocks.slice(1) : blocks;
}

/** The text alone, for callers that only need lines. */
export function htmlToParagraphs(html: string, opts: { dropLeadingHeading?: string } = {}): string[] {
  return htmlToBlocks(html, opts).filter((b) => b.kind !== "fees").map((b) => b.text);
}

export type OfferDocumentProps = {
  logoUrl: string | null;
  letterhead: LetterheadCampus | null;
  studentName: string;
  reference: string;
  bodyHtml: string;
  termsHtml: string;
  fees: FeeSnapshot | null;
  expiresOn: string | null;
  sentOn: string | null;
};

/** The fee lines from the snapshot, with the amount payable to accept in bold. */
function FeeTable({ fees, titled = false }: { fees: FeeSnapshot | null; titled?: boolean }) {
  if (!fees) return null;
  return (
    <View style={{ marginTop: 4, marginBottom: 10 }} wrap={false}>
      {titled ? <Text style={s.h2}>Fees ({fees.currency})</Text> : null}
      {fees.lines.map((l) => (
        <View key={l.code} style={s.row}><Text>{l.label}{l.payable_at_acceptance ? " (payable to accept)" : ""}</Text><Text>{formatMoney(l.amount_minor, fees.currency)}</Text></View>
      ))}
      <View style={s.row}><Text style={s.bold}>Payable to accept</Text><Text style={s.bold}>{formatMoney(fees.payable_at_acceptance_minor, fees.currency)}</Text></View>
    </View>
  );
}

export function OfferDocument(p: OfferDocumentProps) {
  return (
    <Document title={`${p.studentName} — ${SCHOOL_NAME} offer of admission`} author={SCHOOL_NAME}>
      <Page size="A4" style={s.page}>
        <Letterhead logoUrl={p.logoUrl} campus={p.letterhead} lines={["Offer of admission", `Reference ${p.reference}`]} />
        <Text style={s.small}>{p.sentOn ? `Issued ${p.sentOn}` : "Draft"}{p.expiresOn ? ` · open until ${p.expiresOn}` : ""}</Text>
        <View style={{ marginTop: 12 }}>
          {(() => {
            const blocks = htmlToBlocks(p.bodyHtml, { dropLeadingHeading: "Offer of Admission" });
            const placed = blocks.some((b) => b.kind === "fees");
            const out = blocks.map((b, i) =>
              b.kind === "fees" ? <FeeTable key={i} fees={p.fees} /> : b.kind === "heading" ? <Text key={i} style={s.heading}>{b.text}</Text> : <Text key={i} style={s.para}>{b.text}</Text>
            );
            if (!placed && p.fees) out.push(<FeeTable key="fees" fees={p.fees} titled />);
            return out;
          })()}
        </View>
        <Text style={s.h2} minPresenceAhead={60}>Terms</Text>
        {htmlToParagraphs(p.termsHtml, { dropLeadingHeading: "Terms" }).map((line, i) => (
          <Text key={i} style={{ ...s.para, fontSize: 10 }}>{line}</Text>
        ))}
        <LetterFoot text="Admissions · Generated from the offer template in force on the date of issue." />
      </Page>
    </Document>
  );
}
