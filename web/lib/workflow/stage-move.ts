import { can, type PermissionCode, type PermissionSet } from "@/lib/permissions";
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
 * And back, since the school asked for that too the same day: a child at
 * Offer, Payment or Registration can go back to Decision (to be decided
 * again) or to Offer (a fresh letter, drafted for approval). Whatever letter
 * was out or accepted is withdrawn — the signed acceptance stays on file as
 * what happened — and an unpaid payment request is closed. Never past money:
 * once a payment has been received, going back would leave it attached to a
 * letter nobody holds, so the move is refused until finance has refunded it.
 *
 * Enquiry and Assessment are not targets either way. Nobody is moved *to* the
 * start, and the assessment is reached by booking one, which the page already
 * does.
 */

export type MoveTarget = "decision" | "offer" | "payment" | "registration";

export const MOVE_TARGETS: ReadonlyArray<{
  key: MoveTarget;
  stage: JourneyStage;
  label: string;
  explain: string;
  /**
   * What the move does on the way, beyond `applications.move_stage`. Offer
   * records an approval, which is `decisions.override` everywhere else, and
   * Payment also approves the letter, which is `offers.approve`. Without
   * these, granting Move to stage to a role would hand it both by the back
   * door. Decision and Registration record neither.
   */
  needs: readonly PermissionCode[];
  /** Going back to this stage, where that is allowed: what it does, and what it needs. */
  back?: { explain: string; needs: readonly PermissionCode[] };
}> = [
  {
    key: "decision",
    stage: "decision",
    label: "Decision",
    explain: "Skip the assessment. The child waits for an admission decision. The parent is not emailed.",
    needs: [],
    back: {
      explain: "Decide again. Any offer the family has is withdrawn and any unpaid payment is cancelled. The parent is not emailed; a new offer goes once the child is accepted again.",
      // Withdrawing a letter is an offer approver's act everywhere else.
      needs: ["offers.approve"],
    },
  },
  {
    key: "offer",
    stage: "offer",
    label: "Offer",
    explain: "Accept the child and draft the offer. It waits for approval, and the parent is emailed when it is sent.",
    needs: ["decisions.override"],
    back: {
      explain: "Redraft the offer. The letter the family has (or accepted) is withdrawn, any unpaid payment is cancelled, and a new letter waits for your approval before it is sent.",
      needs: ["offers.approve"],
    },
  },
  {
    key: "payment",
    stage: "payment",
    label: "Payment",
    explain: "Accept the child, approve the offer and record that the family accepted it. The parent is emailed only what to pay.",
    needs: ["decisions.override", "offers.approve"],
  },
  {
    key: "registration",
    stage: "registered",
    label: "Registration",
    explain: "Open the registration form now. The parent is emailed that registration is due, and gets no payment messages.",
    needs: [],
  },
];

export type MoveDirection = "forward" | "back";

/** Whether this person may make this move at all: Move to stage, and whatever the move does on the way. */
export function mayMoveTo(permissions: PermissionSet, target: MoveTarget, direction: MoveDirection = "forward"): boolean {
  const t = MOVE_TARGETS.find((x) => x.key === target);
  const needs = (direction === "back" ? t?.back?.needs : t?.needs) ?? [];
  if (direction === "back" && !t?.back) return false;
  return can(permissions, "applications.move_stage") && needs.every((p) => can(permissions, p));
}

/**
 * The stages this person may move the child to now, in journey order, either
 * way. `moneyReceived` (a payment request with money against it) takes the
 * way back off the list: the server refuses it anyway, and offering a button
 * that always says no is worse than not offering it.
 */
export function moveTargetsFor(status: ApplicationStatus, permissions: PermissionSet, opts: { moneyReceived?: boolean } = {}): MoveTarget[] {
  return moveTargetsFrom(status).filter((t) => {
    const direction = moveDirection(status, t);
    if (!direction) return false;
    if (direction === "back" && opts.moneyReceived) return false;
    return mayMoveTo(permissions, t, direction);
  });
}

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

/**
 * Where a status sits for moving *back*, or null where a child cannot be
 * moved back from here. Only from Offer onwards, because Decision and Offer
 * are the only stages there is to go back to.
 *
 * Null, and why, beyond the statuses before Offer:
 *   - `payment_processing`: the gateway has the money in flight.
 *   - `paid`: money has arrived, and registration opens a moment later.
 *   - `enrolled`, and the closed statuses: finished.
 *
 * Registration is included because a child can reach it without paying —
 * moved there by hand, or with nothing to pay. One who did pay is refused
 * when the move is made (`assertNoMoneyHeld`), and not offered the move on
 * screen (`moveTargetsFor`'s `moneyReceived`).
 */
export function backPosition(status: ApplicationStatus): number | null {
  const at = (stage: JourneyStage) => JOURNEY_INDEX.get(stage) ?? null;
  switch (status) {
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
    case "registration_incomplete":
    case "registration_complete":
      return at("registered");
    default:
      return null;
  }
}

function targetIndex(target: MoveTarget): number {
  const stage = MOVE_TARGETS.find((t) => t.key === target)?.stage;
  return stage ? (JOURNEY_INDEX.get(stage) ?? -1) : -1;
}

/** Which way a move to this stage goes from this status, or null where it is not allowed. */
export function moveDirection(status: ApplicationStatus, target: MoveTarget): MoveDirection | null {
  const ahead = movePosition(status);
  if (ahead !== null && targetIndex(target) > ahead) return "forward";
  const behind = backPosition(status);
  const canGoBack = Boolean(MOVE_TARGETS.find((t) => t.key === target)?.back);
  if (canGoBack && behind !== null && targetIndex(target) < behind) return "back";
  return null;
}

/** Whether a child in this status may be moved to that stage, either way. */
export function canMoveTo(status: ApplicationStatus, target: MoveTarget): boolean {
  return moveDirection(status, target) !== null;
}

/** The stages this status may move to, either way, in journey order; empty where nothing may be moved. */
export function moveTargetsFrom(status: ApplicationStatus): MoveTarget[] {
  return MOVE_TARGETS.filter((t) => canMoveTo(status, t.key)).map((t) => t.key);
}

export function isMoveTarget(value: unknown): value is MoveTarget {
  return MOVE_TARGETS.some((t) => t.key === value);
}

/** "Payment", or "Back to Offer". */
export function moveTargetLabel(target: MoveTarget, direction: MoveDirection = "forward"): string {
  const label = MOVE_TARGETS.find((t) => t.key === target)?.label ?? target;
  return direction === "back" ? `Back to ${label}` : label;
}

/** What the move does and what the parent hears, as the picker says it. */
export function moveTargetExplain(target: MoveTarget, direction: MoveDirection): string {
  const t = MOVE_TARGETS.find((x) => x.key === target);
  return (direction === "back" ? t?.back?.explain : t?.explain) ?? "";
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

/**
 * The tasks a move back makes pointless: those about the letter and the
 * payment that have just been withdrawn and cancelled, and the enrolment a
 * registration was heading for. Not `confirm_reported_payment`: money a
 * family says they sent still has to be found, whatever stage they are at.
 */
export const BACK_MOOT_TASKS: readonly string[] = [
  ...STAGE_TASKS.offer,
  ...STAGE_TASKS.payment,
  "confirm_enrolment",
  "documents_missing",
];

/** Every task type belonging to a stage before the target. */
export function mootTaskTypes(target: MoveTarget): string[] {
  const upTo = targetIndex(target);
  return JOURNEY.slice(0, Math.max(0, upTo))
    .flatMap((s) => (s.key === "registered" ? [] : STAGE_TASKS[s.key]));
}
