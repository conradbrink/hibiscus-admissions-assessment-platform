import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { LetterFoot, Letterhead, SCHOOL_NAME, type LetterheadCampus } from "@/lib/documents/letterhead";
import { formatMoney } from "@/lib/money";

/**
 * A receipt for fees paid to secure a place. Rendered on demand from the
 * payment row and the request's lines; nothing is stored. Wording a parent
 * reads comes with the payment_received email; this document carries the
 * figures and references.
 */

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 56, paddingHorizontal: 44, fontSize: 11, fontFamily: "Helvetica", color: "#1f2937", lineHeight: 1.45 },
  title: { fontSize: 22, fontFamily: "Helvetica-Bold", marginTop: 4, marginBottom: 12, lineHeight: 1.2 },
  h2: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 16, marginBottom: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb" },
  bold: { fontFamily: "Helvetica-Bold" },
  small: { fontSize: 9, color: "#6b7280" },
  meta: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
});

export type ReceiptDocumentProps = {
  logoUrl: string | null;
  letterhead: LetterheadCampus | null;
  reference: string;
  receiptNumber: string;
  studentName: string;
  payerName: string;
  campus: string;
  grade: string;
  currency: string;
  lines: Array<{ label: string; amount_minor: number }>;
  amountMinor: number;
  method: "online" | "eft" | "waived";
  providerLabel: string;
  paymentReference: string;
  approvalCode: string | null;
  paidOn: string;
};

export function ReceiptDocument(p: ReceiptDocumentProps) {
  return (
    <Document title={`Receipt ${p.receiptNumber} — ${SCHOOL_NAME}`} author={SCHOOL_NAME}>
      <Page size="A4" style={s.page}>
        <Letterhead logoUrl={p.logoUrl} campus={p.letterhead} lines={["Receipt", p.receiptNumber]} />
        <Text style={s.title}>Receipt</Text>
        <View style={{ marginBottom: 10 }}>
          <View style={s.meta}><Text style={s.small}>Receipt number</Text><Text>{p.receiptNumber}</Text></View>
          <View style={s.meta}><Text style={s.small}>Date</Text><Text>{p.paidOn}</Text></View>
          <View style={s.meta}><Text style={s.small}>Application reference</Text><Text>{p.reference}</Text></View>
          <View style={s.meta}><Text style={s.small}>Received from</Text><Text>{p.payerName}</Text></View>
          <View style={s.meta}><Text style={s.small}>For</Text><Text>{p.studentName} — {p.grade}, {p.campus}</Text></View>
          <View style={s.meta}><Text style={s.small}>Paid by</Text><Text>{p.method === "eft" ? "Bank transfer" : p.method === "waived" ? "Waived by the school" : `Online (${p.providerLabel})`}</Text></View>
          <View style={s.meta}><Text style={s.small}>Payment reference</Text><Text>{p.paymentReference}</Text></View>
          {p.approvalCode ? <View style={s.meta}><Text style={s.small}>Approval code</Text><Text>{p.approvalCode}</Text></View> : null}
        </View>
        <Text style={s.h2}>Fees ({p.currency})</Text>
        {p.lines.map((l, i) => (
          <View key={i} style={s.row}><Text>{l.label}</Text><Text>{formatMoney(l.amount_minor, p.currency)}</Text></View>
        ))}
        <View style={s.row}><Text style={s.bold}>Amount received</Text><Text style={s.bold}>{formatMoney(p.amountMinor, p.currency)}</Text></View>
        <LetterFoot text="Admissions · Generated from the payment record on the date shown." />
      </Page>
    </Document>
  );
}
