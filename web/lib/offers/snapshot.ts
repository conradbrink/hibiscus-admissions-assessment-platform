import type { ApplicationGraph } from "@/lib/applications";
import { renderHtml, type TemplateVariables } from "@/lib/email/render";
import { formatDateLong } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import type { FeeCode, FeeLineRow, FeeScheduleRow, OfferTemplateRow } from "@/lib/supabase/types";

/**
 * The pure half of offer rendering: a fee schedule becomes a snapshot, an
 * application becomes template variables, a template plus variables becomes
 * HTML. No database here, so vitest covers it; `render.ts` does the loading.
 */

export type FeeSnapshot = {
  currency: "BWP" | "ZAR";
  lines: Array<{ code: FeeCode; label: string; amount_minor: number; payable_at_acceptance: boolean }>;
  total_minor: number;
  payable_at_acceptance_minor: number;
};

export function snapshotFees(schedule: Pick<FeeScheduleRow, "currency">, lines: FeeLineRow[]): FeeSnapshot {
  const snapshot: FeeSnapshot = {
    currency: schedule.currency,
    lines: [...lines]
      .sort((a, b) => a.position - b.position)
      .map((l) => ({ code: l.code, label: l.label, amount_minor: Number(l.amount_minor), payable_at_acceptance: l.payable_at_acceptance })),
    total_minor: 0,
    payable_at_acceptance_minor: 0,
  };
  for (const l of snapshot.lines) {
    snapshot.total_minor += l.amount_minor;
    if (l.payable_at_acceptance) snapshot.payable_at_acceptance_minor += l.amount_minor;
  }
  return snapshot;
}

/** Reads a stored `offers.fees` value back as a snapshot, or null for the empty placeholder. */
export function feeSnapshotFrom(value: unknown): FeeSnapshot | null {
  return value && typeof value === "object" && "lines" in (value as object) ? (value as FeeSnapshot) : null;
}

export function buildOfferVariables(
  graph: Pick<ApplicationGraph, "application" | "contact" | "campus" | "grade" | "intake">,
  fees: FeeSnapshot | null,
  opts: { expiresAt: Date | null; conditions: string | null }
): TemplateVariables {
  const { application, contact, campus, grade, intake } = graph;
  const line = (code: FeeCode) => {
    const l = fees?.lines.find((x) => x.code === code);
    return l && fees ? formatMoney(l.amount_minor, fees.currency) : null;
  };
  return {
    parent_first_name: contact.first_name,
    parent_last_name: contact.last_name,
    student_first_name: application.child_first_name,
    student_last_name: application.child_last_name,
    campus: campus.name,
    grade: grade.name,
    intake: intake.label,
    start_date: formatDateLong(intake.starts_on),
    offer_expiry_date: opts.expiresAt ? formatDateLong(opts.expiresAt) : null,
    application_reference: application.reference,
    registration_fee: line("registration"),
    admission_fee: line("admission"),
    tuition_annual: line("tuition_annual"),
    tuition_term: line("tuition_term"),
    amount_due: fees ? formatMoney(fees.payable_at_acceptance_minor, fees.currency) : null,
    currency: fees?.currency ?? campus.currency,
    conditions: opts.conditions,
  };
}

export function renderOffer(template: Pick<OfferTemplateRow, "body_html" | "terms_html" | "allowed_variables">, vars: TemplateVariables) {
  return {
    html: renderHtml(template.body_html, vars, template.allowed_variables),
    terms: renderHtml(template.terms_html, vars, template.allowed_variables),
  };
}
