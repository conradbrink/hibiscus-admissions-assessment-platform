import type { FactRow } from "@/lib/analytics/breakdown";
import { rate } from "@/lib/analytics/breakdown";

/**
 * The forecast: expected enrolments per campus and grade for an academic
 * year, from the pipeline in flight and the conversion each stage has
 * shown historically. Transparent arithmetic — every rate and sample size
 * is shown beside the number it produced — and nothing more.
 */

/** Where an application stands, coarsened to the stages whose conversion we measure. */
export type Stage = "enquired" | "booked" | "assessed" | "approved" | "offered" | "accepted" | "paid" | "registering" | "enrolled" | "closed";

export function stageOf(r: Pick<FactRow, "status" | "booked_at" | "assessed_at">): Stage {
  switch (r.status) {
    case "enrolled":
      return "enrolled";
    case "withdrawn":
    case "declined":
    case "offer_declined":
    case "offer_expired":
      return "closed";
    case "registration_incomplete":
    case "registration_complete":
      return "registering";
    case "paid":
      return "paid";
    case "offer_accepted":
    case "payment_required":
    case "payment_processing":
      return "accepted";
    case "offer_sent":
      return "offered";
    case "approved":
    case "offer_draft":
    case "offer_pending_approval":
      return "approved";
    case "waitlisted":
      return "closed";
    case "assessment_completed":
    case "awaiting_decision":
    case "staff_review":
      return "assessed";
    case "assessment_booked":
    case "assessment_in_progress":
      return "booked";
    default:
      return r.assessed_at ? "assessed" : r.booked_at ? "booked" : "enquired";
  }
}

export const OPEN_STAGES: Stage[] = ["enquired", "booked", "assessed", "approved", "offered", "accepted", "paid", "registering"];

/** Sensible defaults for a stage → enrolment rate when history is too thin to say. */
export const DEFAULT_RATES: Record<Stage, number> = {
  enquired: 0.3,
  booked: 0.45,
  assessed: 0.6,
  approved: 0.75,
  offered: 0.8,
  accepted: 0.9,
  paid: 0.97,
  registering: 0.98,
  enrolled: 1,
  closed: 0,
};

export const MIN_SAMPLE = 20;

export type StageRate = { stage: Stage; rate: number; sample: number; source: "history" | "default" };

/**
 * The historical probability that an application which reached a stage
 * went on to enrol, from closed history: applications that are enrolled or
 * closed. An application still in flight says nothing yet.
 */
export function historicalRates(history: FactRow[]): Record<Stage, StageRate> {
  const settled = history.filter((r) => r.status === "enrolled" || stageOf(r) === "closed");
  const reached = (stage: Stage) => settled.filter((r) => reachedStage(r, stage));
  const out = {} as Record<Stage, StageRate>;
  for (const stage of [...OPEN_STAGES, "enrolled", "closed"] as Stage[]) {
    const group = reached(stage);
    const enrolled = group.filter((r) => r.status === "enrolled").length;
    const r = rate(enrolled, group.length);
    out[stage] = r !== null && group.length >= MIN_SAMPLE ? { stage, rate: r, sample: group.length, source: "history" } : { stage, rate: DEFAULT_RATES[stage], sample: group.length, source: "default" };
  }
  return out;
}

/** Whether a (settled) application ever reached a stage, from its milestone timestamps. */
export function reachedStage(r: FactRow, stage: Stage): boolean {
  switch (stage) {
    case "enquired":
      return true;
    case "booked":
      return !!r.booked_at || !r.requires_assessment;
    case "assessed":
      return !!r.assessed_at || !r.requires_assessment;
    case "approved":
      return r.decision_outcome === "approved" || !!r.offered_at;
    case "offered":
      return !!r.offered_at;
    case "accepted":
      return !!r.accepted_at;
    case "paid":
      return !!r.paid_at;
    case "registering":
      return !!r.paid_at;
    case "enrolled":
      return !!r.enrolled_at;
    case "closed":
      return stageOf(r) === "closed";
  }
}

export type ForecastLine = {
  campusId: string;
  campus: string;
  gradeId: string;
  grade: string;
  gradeSort: number;
  capacity: number | null;
  committed: number;
  pipeline: Partial<Record<Stage, number>>;
  expected: number;
  fill: number | null;
  remaining: number | null;
  enquiriesNeeded: number | null;
  lowConfidence: boolean;
};

const COMMITTED: ReadonlySet<Stage> = new Set(["approved", "offered", "accepted", "paid", "registering", "enrolled"]);

/**
 * One line per campus-grade in the year: committed = places already held
 * (approved and beyond, the same definition as capacity), expected =
 * enrolled + Σ(in flight at stage × that stage's rate).
 */
export function forecast(
  current: FactRow[],
  rates: Record<Stage, StageRate>,
  capacities: Array<{ campus_id: string; grade_id: string; capacity: number | null; campus_name: string; grade_name: string; grade_sort: number }>
): ForecastLine[] {
  const byKey = new Map<string, FactRow[]>();
  for (const r of current) {
    const k = `${r.campus_id}:${r.grade_id}`;
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  const lines: ForecastLine[] = [];
  for (const cg of capacities) {
    const rows = byKey.get(`${cg.campus_id}:${cg.grade_id}`) ?? [];
    const pipeline: Partial<Record<Stage, number>> = {};
    let expected = 0;
    let committed = 0;
    let lowConfidence = false;
    for (const r of rows) {
      const s = stageOf(r);
      if (s === "closed") continue;
      pipeline[s] = (pipeline[s] ?? 0) + 1;
      if (COMMITTED.has(s)) committed += 1;
      expected += s === "enrolled" ? 1 : rates[s].rate;
      if (s !== "enrolled" && rates[s].source === "default") lowConfidence = true;
    }
    const expectedRounded = Math.round(expected * 10) / 10;
    const remaining = cg.capacity === null ? null : Math.max(0, cg.capacity - committed);
    const shortfall = cg.capacity === null ? null : Math.max(0, cg.capacity - expected);
    const enquiryRate = rates.enquired.rate;
    lines.push({
      campusId: cg.campus_id,
      campus: cg.campus_name,
      gradeId: cg.grade_id,
      grade: cg.grade_name,
      gradeSort: cg.grade_sort,
      capacity: cg.capacity,
      committed,
      pipeline,
      expected: expectedRounded,
      fill: cg.capacity === null || cg.capacity === 0 ? null : expected / cg.capacity,
      remaining,
      enquiriesNeeded: shortfall === null ? null : enquiryRate > 0 ? Math.ceil(shortfall / enquiryRate) : null,
      lowConfidence,
    });
  }
  return lines.sort((a, b) => a.campus.localeCompare(b.campus) || a.gradeSort - b.gradeSort);
}
