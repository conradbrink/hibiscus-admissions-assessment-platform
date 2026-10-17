import type { Sheet } from "@/lib/enrolment/xlsx";
import { formatMoney } from "@/lib/money";
import { HOUSEHOLD_LABELS, SERVICE_LABELS, weekdaysLabel } from "@/lib/transport/days";
import { ledgerBy, ledgerLine, ledgerTotals, type LedgerTotals } from "@/lib/transport/ledger";
import type { PeriodLike } from "@/lib/transport/periods";
import { byRoute, toLedgerRider, type StaffRider } from "@/lib/transport/staff-rider";

/**
 * The transport earnings workbook finance downloads: the totals, the same
 * totals by school and by period, and one row per child's line.
 *
 * A line is named by its booking reference and the child's place on it, not
 * by the child: a finance file is reconciled against the bank and the payouts,
 * and the names are in the app for anybody who needs them. The figures are
 * `ledger.ts`'s, so the file and the page cannot disagree.
 */

export type EarningsMeta = {
  periodLabel: string;
  schools: readonly string[];
  takenAt: string;
  takenBy: string;
  awaiting: { bookings: number; amountMinor: number };
  /** Every payout a line's items name, for the "paid in" columns. */
  payouts: ReadonlyMap<string, { paid_on: string; bank_reference: string }>;
};

const pula = (minor: number) => minor / 100;

export const SUMMARY_ROWS: ReadonlyArray<readonly [keyof LedgerTotals, string]> = [
  ["paidByParent", "Paid by parents"],
  ["refunded", "Refunded to parents"],
  ["providerShare", "The provider's share"],
  ["paidToProvider", "Paid to the provider"],
  ["owedToProvider", "Still owed to the provider"],
  ["hibiscusKeeps", "Hibiscus keeps"],
  ["creditToDecide", "Credits still to decide (at most)"],
];

const GROUP_HEADERS = ["Bookings", "Children riding", "Cancelled after payment", "Paid by parents", "Refunded", "Provider's share", "Paid to provider", "Still owed", "Hibiscus keeps"];
const MONEY = { format: "money" as const, width: 14 };
const COUNT = { format: "count" as const, width: 10 };

const groupRow = (label: string, t: LedgerTotals) => [
  label,
  t.bookings,
  t.children,
  t.cancelled,
  pula(t.paidByParent),
  pula(t.refunded),
  pula(t.providerShare),
  pula(t.paidToProvider),
  pula(t.owedToProvider),
  pula(t.hibiscusKeeps),
];

export function earningsSheets(riders: readonly StaffRider[], periods: ReadonlyMap<string, PeriodLike>, meta: EarningsMeta): Sheet[] {
  const paid = riders.filter((r) => r.booking.paidAt !== null).sort(byRoute);
  const totals = ledgerTotals(paid.map(toLedgerRider));
  const bySchool = ledgerBy(
    [...paid].sort((a, b) => a.schoolSort - b.schoolSort || a.school.localeCompare(b.school)).map((r) => ({ ...toLedgerRider(r), school: r.school })),
    (r) => r.school
  );
  const periodOrder = (id: string) => {
    const p = periods.get(id);
    return `${p?.starts_on ?? ""}${p?.kind === "term" ? "0" : "1"}`;
  };
  const byPeriod = ledgerBy(
    [...paid].sort((a, b) => periodOrder(a.booking.periodId).localeCompare(periodOrder(b.booking.periodId))).map((r) => ({ ...toLedgerRider(r), periodId: r.booking.periodId })),
    (r) => r.periodId
  );
  const paidIn = (r: StaffRider, kind: "charge" | "credit") => {
    const item = r.items.find((i) => i.kind === kind);
    if (!item) return "";
    const p = meta.payouts.get(item.payoutId);
    return p ? `${p.paid_on} ${p.bank_reference}` : "Recorded";
  };

  return [
    {
      name: "Summary",
      headers: ["Figure", "Amount (P)"],
      rows: SUMMARY_ROWS.map(([k, label]) => [label, pula(totals[k])]),
      columns: [{ width: 34 }, MONEY],
    },
    {
      name: "By school",
      headers: ["School", ...GROUP_HEADERS],
      rows: bySchool.map((g) => groupRow(g.key, g.totals)),
      freezeHeader: true,
      columns: [{ width: 20 }, COUNT, COUNT, COUNT, MONEY, MONEY, MONEY, MONEY, MONEY, MONEY],
    },
    {
      name: "By period",
      headers: ["Booked for", ...GROUP_HEADERS],
      rows: byPeriod.map((g) => groupRow(periods.get(g.key)?.label ?? "", g.totals)),
      freezeHeader: true,
      columns: [{ width: 24 }, COUNT, COUNT, COUNT, MONEY, MONEY, MONEY, MONEY, MONEY, MONEY],
    },
    {
      name: "Lines",
      headers: [
        "Booking reference",
        "Child",
        "School",
        "Grade",
        "Booked for",
        "Service",
        "Days",
        "Sibling rate",
        "Status",
        "Paid by parent",
        "Refunded",
        "Provider's share",
        "Paid to provider",
        "Still owed",
        "Charged in payout",
        "Credited in payout",
      ],
      rows: paid.map((r) => {
        const f = ledgerLine(toLedgerRider(r));
        return [
          r.reference,
          `Child ${r.position}`,
          r.school,
          r.grade,
          periods.get(r.booking.periodId)?.label ?? "",
          SERVICE_LABELS[r.service],
          weekdaysLabel(r.days),
          HOUSEHOLD_LABELS[r.household],
          r.status === "booked" ? "Riding" : "Cancelled",
          pula(f.paidByParent),
          pula(f.refunded),
          pula(f.providerShare),
          pula(f.paidToProvider),
          pula(f.owedToProvider),
          paidIn(r, "charge"),
          paidIn(r, "credit"),
        ];
      }),
      freezeHeader: true,
      columns: [{ width: 18 }, { width: 9 }, { width: 18 }, { width: 12 }, { width: 22 }, { width: 28 }, { width: 28 }, { width: 30 }, { width: 10 }, MONEY, MONEY, MONEY, MONEY, MONEY, { width: 24 }, { width: 24 }],
    },
    {
      name: "About",
      headers: ["", ""],
      rows: [
        ["Report", `School transport earnings: ${meta.periodLabel}`],
        ["Schools", meta.schools.join(", ")],
        ["Bookings paid", String(totals.bookings)],
        ["Children riding", String(totals.children)],
        ["Cancelled after payment", String(totals.cancelled)],
        [
          "Not counted",
          meta.awaiting.bookings
            ? `${meta.awaiting.bookings} booking${meta.awaiting.bookings === 1 ? " is" : "s are"} awaiting payment (${formatMoney(meta.awaiting.amountMinor, "BWP")}). Money is counted when it arrives.`
            : "No booking is awaiting payment.",
        ],
        ["Amounts", "In pula, including VAT. A credit to decide is the most that could be credited; finance and the provider agree the amount."],
        ["Taken", meta.takenAt],
        ["Taken by", meta.takenBy],
      ],
    },
  ];
}
