import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { LetterFoot, Letterhead, SCHOOL_NAME, type LetterheadCampus } from "@/lib/documents/letterhead";
import { formatMoney } from "@/lib/money";

/**
 * Payslips, one A4 page each, in one document: a whole month for a campus
 * prints in one go, and a single employee's payslip is the same document
 * with one page. Rendered on demand from the stored payslip (its snapshot
 * and lines), so a reprint next year says what it said this month.
 */

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 56, paddingHorizontal: 44, fontSize: 10, fontFamily: "Helvetica", color: "#1f2937", lineHeight: 1.4 },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", color: "#172033", lineHeight: 1.25, marginBottom: 4 },
  subtitle: { fontSize: 10, color: "#6b7280", marginBottom: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 12, borderWidth: 0.5, borderColor: "#e5e7eb", borderRadius: 3 },
  cell: { width: "33.33%", paddingVertical: 5, paddingHorizontal: 7 },
  label: { fontSize: 7.5, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4 },
  cols: { flexDirection: "row", gap: 16 },
  col: { flex: 1 },
  h2: { fontSize: 10, fontFamily: "Helvetica-Bold", color: "#172033", marginBottom: 4, paddingBottom: 3, borderBottomWidth: 1, borderBottomColor: "#172033" },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5, borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb" },
  total: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, fontFamily: "Helvetica-Bold" },
  net: { marginTop: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, paddingHorizontal: 10, backgroundColor: "#E6F1ED", borderRadius: 3 },
  netLabel: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  netValue: { fontSize: 15, fontFamily: "Helvetica-Bold", color: "#00553E" },
  employer: { marginTop: 14 },
  note: { fontSize: 8, color: "#6b7280", marginTop: 3 },
  mark: { fontSize: 7, color: "#6b7280" },
});

export type PayslipPage = {
  snapshot: {
    employee_number: string;
    name: string;
    position: string;
    campus: string | null;
    tax_number: string | null;
    bank_name: string | null;
    account_last4: string | null;
  };
  lines: Array<{ code: string; label: string; kind: "earning" | "deduction" | "tax" | "employer"; effective_minor: number; overridden: boolean }>;
  grossMinor: number;
  deductionsMinor: number;
  netMinor: number;
};

export type PayslipDocumentProps = {
  logoUrl: string | null;
  letterhead: LetterheadCampus | null;
  periodLabel: string;
  payDate: string | null;
  currency: string;
  taxTableCode: string | null;
  status: "draft" | "calculated" | "approved" | "locked";
  payslips: PayslipPage[];
};

function Lines({ items, currency }: { items: PayslipPage["lines"]; currency: string }) {
  return (
    <>
      {items.map((l, i) => (
        <View key={i} style={s.row}>
          <Text>
            {l.label}
            {l.overridden ? <Text style={s.mark}> (adjusted)</Text> : null}
          </Text>
          <Text>{formatMoney(l.effective_minor, currency)}</Text>
        </View>
      ))}
    </>
  );
}

export function PayslipDocument(p: PayslipDocumentProps) {
  const draft = p.status === "draft" || p.status === "calculated";
  return (
    <Document title={`Payslips ${p.periodLabel} - ${SCHOOL_NAME}`} author={SCHOOL_NAME}>
      {p.payslips.map((slip, i) => {
        const earnings = slip.lines.filter((l) => l.kind === "earning");
        const deductions = slip.lines.filter((l) => l.kind === "deduction" || l.kind === "tax");
        const employer = slip.lines.filter((l) => l.kind === "employer");
        return (
          <Page key={i} size="A4" style={s.page}>
            <Letterhead logoUrl={p.logoUrl} campus={p.letterhead} lines={["Payslip", p.periodLabel]} />
            <Text style={s.title}>Payslip{draft ? " (not yet approved)" : ""}</Text>
            <Text style={s.subtitle}>{p.periodLabel}{p.payDate ? `, approved ${p.payDate}` : ""}</Text>

            <View style={s.grid}>
              {(
                [
                  ["Employee", slip.snapshot.name],
                  ["Employee number", slip.snapshot.employee_number],
                  ["Position", slip.snapshot.position],
                  ["School", slip.snapshot.campus ?? ""],
                  ["Tax number", slip.snapshot.tax_number ?? "Not recorded"],
                  ["Paid into", slip.snapshot.bank_name ? `${slip.snapshot.bank_name}${slip.snapshot.account_last4 ? `, account ending ${slip.snapshot.account_last4}` : ""}` : "Not recorded"],
                ] as const
              ).map(([label, value]) => (
                <View key={label} style={s.cell}>
                  <Text style={s.label}>{label}</Text>
                  <Text>{value}</Text>
                </View>
              ))}
            </View>

            <View style={s.cols}>
              <View style={s.col}>
                <Text style={s.h2}>Earnings</Text>
                <Lines items={earnings} currency={p.currency} />
                <View style={s.total}>
                  <Text>Gross pay</Text>
                  <Text>{formatMoney(slip.grossMinor, p.currency)}</Text>
                </View>
              </View>
              <View style={s.col}>
                <Text style={s.h2}>Deductions</Text>
                <Lines items={deductions} currency={p.currency} />
                <View style={s.total}>
                  <Text>Total deductions</Text>
                  <Text>{formatMoney(slip.deductionsMinor, p.currency)}</Text>
                </View>
              </View>
            </View>

            <View style={s.net}>
              <Text style={s.netLabel}>Net pay</Text>
              <Text style={s.netValue}>{formatMoney(slip.netMinor, p.currency)}</Text>
            </View>

            {employer.length ? (
              <View style={s.employer}>
                <Text style={s.h2}>Paid by the school on top of your pay</Text>
                <Lines items={employer} currency={p.currency} />
              </View>
            ) : null}

            {p.taxTableCode ? <Text style={s.note}>Tax worked out with the {p.taxTableCode} tables.</Text> : null}
            <LetterFoot text={`Payslip for ${slip.snapshot.name}, ${p.periodLabel}. Confidential.`} />
          </Page>
        );
      })}
    </Document>
  );
}
