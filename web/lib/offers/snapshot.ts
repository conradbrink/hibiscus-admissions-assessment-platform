import type { ApplicationGraph } from "@/lib/applications";
import { renderHtml, type TemplateVariables } from "@/lib/email/render";
import { formatDateLong, toSchoolDateString } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import { promotionVariables } from "@/lib/promotions/apply";
import type { DayPattern, FeeCode, FeeLineRow, FeeScheduleRow, OfferTemplateRow } from "@/lib/supabase/types";

/**
 * The pure half of offer rendering: a fee schedule becomes a snapshot, an
 * application becomes template variables, a template plus variables becomes
 * HTML. No database here, so vitest covers it; `render.ts` does the loading.
 */

export type FeeSnapshot = {
  currency: "BWP" | "ZAR";
  lines: Array<{
    code: FeeCode;
    label: string;
    amount_minor: number;
    payable_at_acceptance: boolean;
    /** Set once a promotion has touched the line: what the schedule said, and whether nothing is left. */
    original_minor?: number;
    waived?: boolean;
  }>;
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

/** The school's own date, so "has the term started?" is answered in Gaborone. */
function todayInSchoolTime(now: Date): string {
  return toSchoolDateString(now);
}

/**
 * Which of the two term rates a placed child is on. A child with no day
 * pattern has no single rate, and `null` here means `line()` finds nothing —
 * which is what puts both rates on the letter instead.
 */
function termCodeFor(pattern: DayPattern | null): FeeCode {
  return pattern === "full" ? "tuition_term_full" : pattern === "half" ? "tuition_term_half" : "tuition_term";
}

export function buildOfferVariables(
  graph: Pick<ApplicationGraph, "application" | "contact" | "campus" | "grade" | "intake">,
  fees: FeeSnapshot | null,
  opts: { expiresAt: Date | null; conditions: string | null; bankDetails?: string | null; now?: Date }
): TemplateVariables {
  const { application, contact, campus, grade, intake } = graph;
  const now = opts.now ?? new Date();
  const line = (code: FeeCode) => {
    const l = fees?.lines.find((x) => x.code === code);
    if (!l || !fees) return null;
    // A waived line still prints, so the parent sees what the deal covered.
    if (l.waived && l.original_minor) return `Waived (was ${formatMoney(l.original_minor, fees.currency)})`;
    return formatMoney(l.amount_minor, fees.currency);
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
    // The letter used to promise "we will email you everything you need
    // before Term 3 starts" to families joining a term that began a week
    // ago — Term 3 2026 started on 7 September and was still being offered
    // on the 10th. A term already under way needs the other sentence, and
    // whether it is under way is a fact about the day the letter is drafted,
    // which is exactly when this is computed and frozen.
    // Two variables rather than one, because the template language has no
    // {{else}} — two guarded sentences with opposite conditions say the same
    // thing and cost one line of code instead of a parser change.
    intake_not_started: intake.starts_on > todayInSchoolTime(now) ? "yes" : null,
    intake_started: intake.starts_on > todayInSchoolTime(now) ? null : "yes",
    offer_expiry_date: opts.expiresAt ? formatDateLong(opts.expiresAt) : null,
    application_reference: application.reference,
    registration_fee: line("registration"),
    admission_fee: line("admission"),
    tuition_annual: line("tuition_annual"),
    // Pre-school is priced at two rates and a child is placed on one. Once
    // the school has said which, that rate is *the* term fee and prints in
    // the ordinary row. Until they have, both print as a choice rather than
    // the letter guessing or going silent on the largest number in it.
    tuition_term: line("tuition_term") ?? line(termCodeFor(application.day_pattern)),
    tuition_term_half: application.day_pattern ? null : line("tuition_term_half"),
    tuition_term_full: application.day_pattern ? null : line("tuition_term_full"),
    tuition_month: line("tuition_month"),
    stationery_annual: line("stationery_annual"),
    amount_due: fees ? formatMoney(fees.payable_at_acceptance_minor, fees.currency) : null,
    currency: fees?.currency ?? campus.currency,
    conditions: opts.conditions,
    // One line, so it reads the same in the letter's HTML and in the PDF.
    bank_details: opts.bankDetails ? opts.bankDetails.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(" · ") : null,
    ...promotionVariables(fees),
  };
}

export function renderOffer(template: Pick<OfferTemplateRow, "body_html" | "terms_html" | "allowed_variables">, vars: TemplateVariables) {
  return {
    html: renderHtml(template.body_html, vars, template.allowed_variables),
    terms: renderHtml(template.terms_html, vars, template.allowed_variables),
  };
}
