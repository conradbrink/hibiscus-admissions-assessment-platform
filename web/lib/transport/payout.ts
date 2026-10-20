import { z } from "zod";
import type { Sheet } from "@/lib/enrolment/xlsx";
import { toSchoolDateString } from "@/lib/format-date";
import { parseMoneyToMinor } from "@/lib/money";
import { SERVICE_LABELS, weekdaysLabel } from "@/lib/transport/days";
import type { PeriodLike } from "@/lib/transport/periods";
import { byRoute, type StaffRider } from "@/lib/transport/staff-rider";

/**
 * Paying the transport provider: which children it is owed for, which
 * cancelled children a credit may be taken for, the form finance fills in, and
 * the statement and remittance files the provider reads.
 *
 * `transport_record_payout()` is what decides. It works out each charge
 * itself from the child's frozen line, refuses a child already paid for or
 * no longer payable, and caps every credit; this only offers the lines it
 * would accept and reads the form into its arguments.
 */

/** Still booked on a paid booking with this provider, and not yet paid for. */
export function chargeableRiders(riders: readonly StaffRider[], providerId: string): StaffRider[] {
  return riders
    .filter((r) => r.booking.providerId === providerId && r.booking.status === "paid" && r.status === "booked")
    .filter((r) => !r.items.some((i) => i.kind === "charge"))
    .sort(byRoute);
}

/** Cancelled after the provider was paid for them, and not yet credited. */
export function creditableRiders(riders: readonly StaffRider[], providerId: string): StaffRider[] {
  return riders
    .filter((r) => r.booking.providerId === providerId && r.status === "cancelled")
    .filter((r) => r.items.some((i) => i.kind === "charge") && !r.items.some((i) => i.kind === "credit"))
    .sort(byRoute);
}

/** The charge a child's line carries: what the provider is paid for it. */
export function chargeOf(r: StaffRider): number {
  return r.items.filter((i) => i.kind === "charge").reduce((s, i) => s + i.amountMinor, 0);
}

export type PayoutForm = {
  providerId: string;
  paidOn: string;
  bankReference: string;
  note: string | null;
  chargeRiderIds: string[];
  credits: Array<{ rider_id: string; amount_minor: number }>;
};

const CREDIT_FIELD = /^credit:([0-9a-f-]{36})$/i;

const fields = z.object({
  providerId: z.guid(),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date the money was paid."),
  bankReference: z.string().trim().min(1, "Enter the bank reference of the payment.").max(120, "Keep the bank reference to 120 characters."),
  note: z.string().trim().max(1000, "Keep the note to 1,000 characters.").optional(),
});

/**
 * The form, read into the function's arguments. A ticked child is a
 * `charge` field carrying its id; a credit is a `credit:<id>` field carrying
 * an amount in pula, and an empty one means no credit for that child now.
 */
export function parsePayoutForm(entries: Iterable<[string, FormDataEntryValue]>): PayoutForm {
  const list = [...entries].map(([k, v]) => [k, typeof v === "string" ? v : ""] as const);
  const one = (k: string) => list.find(([key]) => key === k)?.[1];
  const base = fields.parse({ providerId: one("providerId"), paidOn: one("paidOn"), bankReference: one("bankReference") ?? "", note: one("note") || undefined });

  const chargeRiderIds = list.filter(([k]) => k === "charge").map(([, v]) => z.guid().parse(v));
  if (new Set(chargeRiderIds).size !== chargeRiderIds.length) throw new Error("A child is ticked twice. Reload the page and try again.");

  const credits: PayoutForm["credits"] = [];
  for (const [k, v] of list) {
    const m = CREDIT_FIELD.exec(k);
    if (!m || !v.trim()) continue;
    const amount = parseMoneyToMinor(v);
    if (amount === null || amount <= 0) throw new Error(`"${v}" is not an amount to credit. Enter it in pula, like 1,250.00, or leave it empty.`);
    credits.push({ rider_id: z.guid().parse(m[1]), amount_minor: amount });
  }
  if (!chargeRiderIds.length) throw new Error("Tick at least one child the provider is being paid for.");
  return { ...base, note: base.note || null, chargeRiderIds, credits };
}

export type PayoutLine = { kind: "charge" | "credit"; rider: StaffRider; amountMinor: number };

const pula = (minor: number) => minor / 100;

/**
 * The lines of a statement (what is owed, before the bank payment) or of a
 * remittance (what a recorded payment covered). A credit is shown as a
 * negative amount so the column adds up to what was paid.
 */
export function payoutSheets(
  lines: readonly PayoutLine[],
  periods: ReadonlyMap<string, PeriodLike>,
  about: ReadonlyArray<readonly [string, string]>
): Sheet[] {
  const rows = lines.map((l) => [
    l.kind === "charge" ? "Charge" : "Credit",
    l.rider.reference,
    l.rider.firstName,
    l.rider.lastName,
    l.rider.school,
    periods.get(l.rider.booking.periodId)?.label ?? "",
    SERVICE_LABELS[l.rider.service],
    weekdaysLabel(l.rider.days),
    pula(l.kind === "charge" ? l.amountMinor : -l.amountMinor),
  ]);
  const total = lines.reduce((s, l) => s + (l.kind === "charge" ? l.amountMinor : -l.amountMinor), 0);
  return [
    {
      name: "Lines",
      headers: ["Line", "Booking reference", "Child first name", "Child surname", "School", "Booked for", "Service", "Days", "Amount (P)"],
      rows: [...rows, ["Total", "", "", "", "", "", "", "", pula(total)]],
      freezeHeader: true,
      columns: [{ width: 9 }, { width: 18 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 22 }, { width: 28 }, { width: 28 }, { width: 14, format: "money" }],
    },
    { name: "About", headers: ["", ""], rows: about.map(([a, b]) => [a, b]) },
  ];
}

/** The charges and credits a statement of what is owed holds: every chargeable child, no credits yet. */
export function statementLines(riders: readonly StaffRider[], providerId: string): PayoutLine[] {
  return chargeableRiders(riders, providerId).map((r) => ({ kind: "charge" as const, rider: r, amountMinor: r.providerAmountMinor ?? 0 }));
}

/** "watermark-payout-2026-10-18-FNB123.xlsx" */
export function payoutFilename(providerCode: string, kind: "statement" | "remittance", date: Date | string, ref?: string): string {
  const day = typeof date === "string" ? date : toSchoolDateString(date);
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return [slug(providerCode) || "provider", kind, day, ref ? slug(ref).slice(0, 30) : ""].filter(Boolean).join("-") + ".xlsx";
}
