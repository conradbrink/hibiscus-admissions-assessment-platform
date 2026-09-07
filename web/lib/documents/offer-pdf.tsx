import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { LetterFoot, Letterhead, SCHOOL_NAME, type LetterheadCampus } from "@/lib/documents/letterhead";
import type { FeeSnapshot } from "@/lib/offers/snapshot";
import { formatMoney } from "@/lib/money";

/**
 * The offer as a PDF, from the snapshot. react-pdf does not render HTML,
 * so the layout is fixed here and the template's prose is included as
 * plain text with tags stripped; the parent's web view shows the HTML.
 */

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 60, paddingHorizontal: 48, fontSize: 10.5, fontFamily: "Helvetica", color: "#1f2937", lineHeight: 1.38 },
  date: { textAlign: "right", fontSize: 10, color: "#374151", marginBottom: 8 },
  heading: { fontFamily: "Helvetica-Bold", fontSize: 12, textAlign: "center", textDecoration: "underline", marginTop: 2, marginBottom: 10 },
  para: { marginBottom: 7 },
  list: { marginLeft: 14, marginBottom: 7 },
  listRow: { flexDirection: "row", marginBottom: 2 },
  listNo: { width: 16 },
  listLabel: { flexGrow: 1, flexShrink: 1, flexBasis: 0, paddingRight: 8 },
  listAmount: { width: 90, textAlign: "right", flexShrink: 0 },
  bold: { fontFamily: "Helvetica-Bold" },
  muted: { color: "#6b7280" },
  bank: { marginTop: 2, marginBottom: 8, paddingVertical: 6, paddingHorizontal: 10, borderWidth: 0.6, borderColor: "#e5e7eb", borderRadius: 4 },
  bankTitle: { fontFamily: "Helvetica-Bold", marginBottom: 2 },
  bankRow: { flexDirection: "row" },
  bankLabel: { width: 110, fontFamily: "Helvetica-Bold" },
  signature: { marginTop: 4, marginBottom: 6 },
  signatureImage: { height: 42, width: 150, objectFit: "contain", objectPosition: "left", marginTop: 4, marginBottom: 2 },
  signatureName: { fontFamily: "Helvetica-Bold" },
  terms: { marginTop: 10, paddingTop: 6, borderTopWidth: 0.5, borderTopColor: "#e5e7eb", fontSize: 8.5, color: "#6b7280", lineHeight: 1.3 },
  termsHead: { fontFamily: "Helvetica-Bold", fontSize: 8.5, color: "#6b7280", marginBottom: 2 },
});

export type OfferBlock = { kind: "heading" | "para" | "fees" | "bank"; text: string };

/**
 * The template's HTML as blocks the PDF can lay out: a heading (h1 to h3,
 * or a paragraph wholly in bold), a paragraph, the place the letter's fee
 * table stood (the PDF prints the same figures from the snapshot), or the
 * account-details paragraph (printed as a labelled block from the bank
 * details the offer was rendered with). Inline tags vanish without leaving
 * a space before punctuation.
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
    else if (/^account details:/i.test(line)) blocks.push({ kind: "bank", text: line });
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
  /** The bank details the letter was rendered with, lines joined by " · " or newlines. */
  bankDetails: string | null;
  expiresOn: string | null;
  sentOn: string | null;
  /** The head of the campus who signs the letter. Absent, the template's own closing line stands. */
  signatory?: Signatory | null;
};

export type Signatory = { name: string | null; title: string | null; imageDataUrl: string | null };

/** A closing line such as "Kind regards, Admissions, Hibiscus…" that the signature block replaces. */
const CLOSING = /^(kind|warm|best) regards|^yours (sincerely|faithfully)/i;

/**
 * When a signatory is known, the letter closes with "Kind regards," and
 * the signature instead of the template's generic closing paragraph.
 * Returns the blocks to print and whether the block belongs at the end.
 */
export function withSignatory<T extends { kind: string; text: string }>(blocks: T[], signatory: Signatory | null | undefined): { blocks: T[]; sign: boolean } {
  const sign = Boolean(signatory && (signatory.name || signatory.imageDataUrl));
  if (!sign) return { blocks, sign: false };
  const last = blocks.at(-1);
  if (last && last.kind === "para" && CLOSING.test(last.text.trim())) return { blocks: blocks.slice(0, -1), sign: true };
  return { blocks, sign: true };
}

function SignatureBlock({ signatory, campusName }: { signatory: Signatory; campusName: string | null }) {
  return (
    <View style={s.signature} wrap={false} minPresenceAhead={80}>
      <Text style={s.para}>Kind regards,</Text>
      {/* react-pdf's Image has no alt prop; the name beneath says whose signature it is. */}
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      {signatory.imageDataUrl ? <Image src={signatory.imageDataUrl} style={s.signatureImage} /> : <View style={{ height: 22 }} />}
      {signatory.name ? <Text style={s.signatureName}>{signatory.name}</Text> : null}
      <Text>{[signatory.title, campusName ? `${campusName} Campus` : null].filter(Boolean).join(", ")}</Text>
      <Text>{SCHOOL_NAME}</Text>
    </View>
  );
}

/** The fees as the letter lists them: the amounts payable to accept, numbered; anything invoiced later beneath; the total in bold. */
function FeeList({ fees }: { fees: FeeSnapshot | null }) {
  if (!fees) return null;
  const upfront = fees.lines.filter((l) => l.payable_at_acceptance);
  const later = fees.lines.filter((l) => !l.payable_at_acceptance);
  return (
    <View style={s.list} wrap={false}>
      {upfront.map((l, i) => (
        <View key={l.code} style={s.listRow}>
          <Text style={s.listNo}>{i + 1}.</Text>
          <Text style={s.listLabel}><Text style={s.bold}>{l.label}</Text> (non-refundable)</Text>
          <Text style={s.listAmount}>{formatMoney(l.amount_minor, fees.currency)}</Text>
        </View>
      ))}
      <View style={s.listRow}>
        <Text style={s.listNo} />
        <Text style={{ ...s.listLabel, ...s.bold }}>Payable to accept the offer</Text>
        <Text style={{ ...s.listAmount, ...s.bold }}>{formatMoney(fees.payable_at_acceptance_minor, fees.currency)}</Text>
      </View>
      {later.map((l) => (
        <View key={l.code} style={{ ...s.listRow, marginTop: 3 }}>
          <Text style={s.listNo} />
          <Text style={{ ...s.listLabel, ...s.muted }}>{l.label}, invoiced by the school</Text>
          <Text style={{ ...s.listAmount, ...s.muted }}>{formatMoney(l.amount_minor, fees.currency)}</Text>
        </View>
      ))}
    </View>
  );
}

/** "Bank: X · Account name: Y" as label and value rows, with the reference the parent must quote. */
function BankBlock({ details, reference }: { details: string | null; reference: string }) {
  if (!details) return null;
  const rows = details
    .split(/\s·\s|\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf(":");
      return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : ["", l];
    });
  return (
    <View style={s.bank} wrap={false}>
      <Text style={s.bankTitle}>Account details</Text>
      {rows.map(([label, value], i) => (
        <View key={i} style={s.bankRow}><Text style={s.bankLabel}>{label}</Text><Text>{value}</Text></View>
      ))}
      <View style={s.bankRow}><Text style={s.bankLabel}>Reference</Text><Text>{reference}</Text></View>
      <Text style={{ ...s.muted, marginTop: 2 }}>Please send proof of payment to the admissions office.</Text>
    </View>
  );
}

export function OfferDocument(p: OfferDocumentProps) {
  return (
    <Document title={`${p.studentName} — ${SCHOOL_NAME} offer of admission`} author={SCHOOL_NAME}>
      <Page size="A4" style={s.page}>
        <Letterhead logoUrl={p.logoUrl} campus={p.letterhead} lines={["Offer of admission", `Reference ${p.reference}`]} />
        <Text style={s.date}>{p.sentOn ?? "Draft"}</Text>
        {(() => {
          const { blocks, sign } = withSignatory(htmlToBlocks(p.bodyHtml, { dropLeadingHeading: "Offer of Admission" }), p.signatory);
          const placed = blocks.some((b) => b.kind === "fees");
          const out = blocks.map((b, i) => {
            if (b.kind === "fees") return <FeeList key={i} fees={p.fees} />;
            if (b.kind === "bank") return <BankBlock key={i} details={p.bankDetails} reference={p.reference} />;
            if (b.kind === "heading") return <Text key={i} style={s.heading}>{b.text}</Text>;
            return <Text key={i} style={s.para}>{b.text}</Text>;
          });
          if (!placed && p.fees) out.push(<FeeList key="fees" fees={p.fees} />);
          if (sign && p.signatory) out.push(<SignatureBlock key="sign" signatory={p.signatory} campusName={p.letterhead?.name ?? null} />);
          return out;
        })()}
        <View style={s.terms} wrap={false}>
          <Text style={s.termsHead}>Terms</Text>
          {htmlToParagraphs(p.termsHtml, { dropLeadingHeading: "Terms" }).map((line, i) => (
            <Text key={i}>{line}</Text>
          ))}
        </View>
        <LetterFoot text="Admissions · Generated from the offer template in force on the date of issue." />
      </Page>
    </Document>
  );
}
