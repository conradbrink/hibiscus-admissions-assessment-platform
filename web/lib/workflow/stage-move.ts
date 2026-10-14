import type { ApplicationStatus } from "@/lib/supabase/types";
import { JOURNEY, type JourneyStage } from "@/lib/workflow/next-step";

/**
 * Move to stage: an admissions officer moves a child forward along the
 * journey bar by hand, skipping the steps between, with a reason.
 *
 * Asked for by the school on 14 October 2026. A family arrives at the desk
 * having paid already, or the school decides a child need not sit the
 * assessment, and staff had no way to move them on: every button waited for
 * the step before it. The pure half lives here so every rule is a unit test
 * (`stage-move.test.ts`); `stage-move-actions.ts` does the moving.
 *
 * Forward only. Moving a family back past a decision, an accepted offer or a
 * payment means undoing records other people rely on (a decision is
 * append-only, an acceptance is a signed record, money may have moved), and
 * those already have their own tools: withdraw the offer, refund, withdraw.
 *
 * Enquiry and Assessment are not targets. Nobody is moved *to* the start, and
 * the assessment is reached by booking one, which the page already does.
 */

export type MoveTarget = "decision" | "offer" | "payment" | "registration";

export const MOVE_TARGETS: ReadonlyArray<{ key: MoveTarget; stage: JourneyStage; label: string; explain: string }> = [
  {
    key: "decision",
    stage: "decision",
    label: "Decision",
    explain: "Skip the assessment. The child waits for an admission decision. The parent is not emailed.",
  },
  {
    key: "offer",
    stage: "offer",
    label: "Offer",
    explain: "Accept the child and draft the offer. It waits for approval, and the parent is emailed when it is sent.",
  },
  {
    key: "payment",
    stage: "payment",
    label: "Payment",
    explain: "Accept the child, approve the offer and record that the family accepted it. The parent is emailed only what to pay.",
  },
  {
    key: "registration",
    stage: "registered",
    label: "Registration",
    explain: "Open the registration form now. The parent is emailed that registration is due, and gets no payment messages.",
  },
];

const JOURNEY_INDEX = new Map<JourneyStage, number>(JOURNEY.map((s, i) => [s.key, i]));

/**
 * Where a status sits for moving forward, as an index into the journey bar,
 * or null where nobody may move the child from here.
 *
 * Not `journeyStageOf`: that answers where to draw the dot, and two of its
 * answers are wrong for this. `deferred` has no stage there, and here it sits
 * at Assessment, so that every stage from Decision on is offered: a family can
 * pause before or while waiting for a decision, and moving one who paused at
 * the decision "to Decision" is simply bringing them back to it, by the edge
 * `deferred → awaiting_decision` the graph already has. `waitlisted` sits at
 * Decision in both.
 *
 * Null, and why:
 *   - `assessment_in_progress`: the child is at the keyboard.
 *   - `payment_processing`: the gateway has the money in flight.
 *   - `paid`: registration opens on its own a moment later.
 *   - registration, enrolment, and the closed statuses: nothing lies ahead
 *     that this moves to.
 */
export function movePosition(status: ApplicationStatus): number | null {
  const at = (stage: JourneyStage) => JOURNEY_INDEX.get(stage) ?? null;
  switch (status) {
    case "new_enquiry":
    case "callback_requested":
      return at("enquiry");
    case "visit_booked":
    case "assessment_booked":
    case "no_show":
    case "assessment_completed":
    case "deferred":
      return at("assessment");
    case "awaiting_decision":
    case "staff_review":
    case "waitlisted":
      return at("decision");
    case "approved":
    case "offer_draft":
    case "offer_pending_approval":
    case "offer_sent":
    case "offer_expired":
    case "offer_declined":
      return at("offer");
    case "offer_accepted":
    case "payment_required":
      return at("payment");
    case "assessment_in_progress":
    case "payment_processing":
    case "paid":
    case "registration_incomplete":
    case "registration_complete":
    case "enrolled":
    case "declined":
    case "withdrawn":
      return null;
  }
}

function targetIndex(target: MoveTarget): number {
  const stage = MOVE_TARGETS.find((t) => t.key === target)?.stage;
  return stage ? (JOURNEY_INDEX.get(stage) ?? -1) : -1;
}

/** Whether a child in this status may be moved to that stage: it must lie ahead. */
export function canMoveTo(status: ApplicationStatus, target: MoveTarget): boolean {
  const from = movePosition(status);
  return from !== null && targetIndex(target) > from;
}

/** The stages ahead of this status, in journey order; empty where nothing may be moved. */
export function moveTargetsFrom(status: ApplicationStatus): MoveTarget[] {
  return MOVE_TARGETS.filter((t) => canMoveTo(status, t.key)).map((t) => t.key);
}

export function isMoveTarget(value: unknown): value is MoveTarget {
  return MOVE_TARGETS.some((t) => t.key === value);
}

export function moveTargetLabel(target: MoveTarget): string {
  return MOVE_TARGETS.find((t) => t.key === target)?.label ?? target;
}

/**
 * The open tasks a move makes pointless, by the stage they belong to. A task
 * asking somebody to ring about a missed sitting, approve a letter or chase a
 * payment the family will no longer be asked for is a task nobody can finish.
 *
 * Deliberately not here: anything finance must still look at once money has
 * moved (`payment_review`, `payment_shortfall`, `payment_refund_review`), a
 * task somebody wrote by hand, and the registration stage's own.
 */
const STAGE_TASKS: Record<Exclude<JourneyStage, "registered">, readonly string[]> = {
  enquiry: ["callback"],
  assessment: ["follow_up_no_show", "deferral_due", "relaunch_assessment"],
  decision: ["review_decision", "review_preschool_enquiry", "send_outcome", "waitlist_place_available"],
  offer: ["approve_offer", "configure_fees", "follow_up_expired_offer", "follow_up_declined_offer"],
  payment: ["payment_overdue", "payment_failed_follow_up"],
};

/** The timeline events that say a stage was skipped by hand. */
export const MOVE_EVENT_TYPES: readonly string[] = ["application.moved_to_stage", "assessment.skipped"];

/**
 * The stages a moved child went past without taking, for the journey bar to
 * leave unticked: those before where they are now with nothing recorded
 * against them. Only once a move has happened — otherwise a stage with no
 * milestone is an ordinary gap the bar already draws its own way — and never
 * Enquiry, which every child has.
 */
export function stagesSkippedByMove(
  current: JourneyStage,
  milestones: Partial<Record<JourneyStage, unknown>>,
  moved: boolean
): JourneyStage[] {
  if (!moved) return [];
  const now = JOURNEY_INDEX.get(current) ?? 0;
  return JOURNEY.filter((s, i) => i > 0 && i < now && !milestones[s.key]).map((s) => s.key);
}

/** Every task type belonging to a stage before the target. */
export function mootTaskTypes(target: MoveTarget): string[] {
  const upTo = targetIndex(target);
  return JOURNEY.slice(0, Math.max(0, upTo))
    .flatMap((s) => (s.key === "registered" ? [] : STAGE_TASKS[s.key]));
}
