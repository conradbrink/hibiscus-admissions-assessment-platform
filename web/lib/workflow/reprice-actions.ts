import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { ApplicationRow, OfferRow } from "@/lib/supabase/types";
import { loadCatalogue } from "@/lib/enquiry";
import { resolveFeeSchedule } from "@/lib/offers/render";
import { formatMonth, intakeForMonth } from "@/lib/start-month";
import { commit, WorkflowError, type Actor } from "@/lib/workflow/engine";
import { onOfferDrafted, onOfferWithdrawn } from "@/lib/workflow/offer-actions";
import { isNextAction } from "@/lib/workflow/states";

/**
 * Changing something a letter is priced from after the letter is written.
 *
 * The month a child starts decides the term, and so the fee year, the letter
 * is priced from. Staff used to be refused once a letter had gone to approval
 * and told to withdraw it first — but withdrawing is only reachable by going
 * back to Decision, and deciding again drafts the next letter in the same
 * click, so there was never a moment the month could change. On 21 October
 * 2026 Nadia Seegers went round that loop twice and stayed on January 2027.
 *
 * So the letter in play is re-priced in the same step, by the rule the
 * scholarship box (`setScholarship`) already uses: one waiting for approval
 * is re-drafted in place, one with the family is withdrawn and drafted again
 * for approval. Nothing is emailed from here; the officer approves the new
 * letter, which is what sends it.
 */

type RepricingApp = Pick<ApplicationRow, "id" | "status" | "child_first_name" | "requires_assessment">;

export type LetterInPlay = {
  letter: Pick<OfferRow, "id" | "status" | "conditions" | "promotion_id" | "start_date" | "fee_schedule_id"> | null;
  /** Sent, viewed or expired: the family has it, so it is withdrawn before the new one is drafted. */
  withFamily: boolean;
  /** Whether saving re-prices a letter at all. A draft waiting for fees takes the change when Generate offer is pressed. */
  reDraft: boolean;
};

/** The newest letter that is still open, and what re-pricing it would take. */
export async function letterInPlay(admin: AdminClient, app: Pick<ApplicationRow, "id" | "status">): Promise<LetterInPlay> {
  const { data: letter, error } = await admin
    .from("offers")
    .select("id, status, conditions, promotion_id, start_date, fee_schedule_id")
    .eq("application_id", app.id)
    .in("status", ["draft", "pending_approval", "sent", "viewed", "expired"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new WorkflowError(error.message, "database");
  const withFamily = Boolean(letter && ["sent", "viewed", "expired"].includes(letter.status) && (app.status === "offer_sent" || app.status === "offer_expired"));
  const reDraft = withFamily || (letter?.status === "pending_approval" && app.status === "offer_pending_approval");
  return { letter, withFamily, reDraft };
}

/**
 * A family that has accepted has made an agreement, and may have paid against
 * it; a child already enrolled is the registrar's. Neither is re-priced here.
 */
export async function refuseOnceAgreed(admin: AdminClient, applicationId: string, what: string): Promise<void> {
  const [accepted, enrolment] = await Promise.all([
    admin.from("offers").select("id").eq("application_id", applicationId).eq("status", "accepted").limit(1).maybeSingle(),
    admin.from("enrolments").select("id").eq("origin_application_id", applicationId).limit(1).maybeSingle(),
  ]);
  if (accepted.error) throw new WorkflowError(accepted.error.message, "database");
  if (enrolment.error) throw new WorkflowError(enrolment.error.message, "database");
  if (enrolment.data) throw new WorkflowError(`This child is already enrolled, so the ${what} is set. Ask the registrar to move the enrolment.`, "status_conflict");
  if (accepted.data) throw new WorkflowError(`The family has accepted the offer, so the ${what} is set. Ask the registrar to move the start.`, "status_conflict");
}

/**
 * Refuses before anything changes when the new letter could not be priced.
 * A family's letter is withdrawn only when one can replace it; otherwise
 * their link would stop working with nothing to show for it.
 */
export async function requirePriceable(admin: AdminClient, opts: { campusId: string; academicYearId: string; gradeSort: number }): Promise<void> {
  const schedule = await resolveFeeSchedule(admin, opts);
  if (!schedule || schedule.lines.length === 0) {
    throw new WorkflowError("No active fee schedule covers this campus, stage and year, so a new letter could not be priced. Nothing was changed; set the fees first.", "status_conflict");
  }
}

/** Withdraws the family's letter when they have it, then drafts the next one for approval. */
export async function reissueLetter(admin: AdminClient, app: Pick<ApplicationRow, "id" | "status">, play: LetterInPlay, reason: string, actor: Actor): Promise<void> {
  if (!play.reDraft) return;
  if (play.withFamily && play.letter) await onOfferWithdrawn(admin, app, play.letter, reason, actor);
  const { data: current, error } = await admin.from("applications").select("id, status, child_first_name, requires_assessment").eq("id", app.id).single();
  if (error) throw new WorkflowError(error.message, "database");
  // Waits for approval whatever `offer_auto_approve` says: the officer checks
  // the new letter before it goes. The conditions the old letter carried
  // carry over, as they do when it is re-drafted in place.
  const drafted = await onOfferDrafted(admin, current as RepricingApp, actor, { autoApprove: false, conditions: play.letter?.conditions ?? null });
  if (drafted.blocked) throw new WorkflowError("The change is saved, but the letter could not be priced: no active fee schedule covers this campus, stage and year.", "status_conflict");
}

/**
 * The month a child starts, at a campus that takes children in by the month,
 * with the letter re-priced to match. `mayReprice` is whether the person may
 * approve offers: re-drafting a letter is theirs to do, so without it a
 * written letter refuses the change rather than quietly pulling it.
 *
 * Saving the month the child already has is not always nothing to do. The
 * month is saved before the letter is re-drafted, so a re-draft that failed
 * (a database error, a schedule switched off in between) left the month moved
 * and the letter priced from the old one, and pressing Save again found
 * nothing changed. The letter's own start date says which month it was
 * priced for; when it disagrees, the re-draft is what is left to do.
 */
export async function onStartMonthChanged(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "status" | "campus_id" | "grade_id" | "intake_id" | "start_month" | "next_action">,
  to: string | null,
  actor: Actor,
  opts: { mayReprice: boolean }
): Promise<{ reissued: boolean }> {
  const { data: campus, error: campusErr } = await admin.from("campuses").select("intake_cadence").eq("id", app.campus_id).single();
  if (campusErr) throw new WorkflowError(campusErr.message, "database");
  if (campus.intake_cadence !== "month") {
    if (app.start_month === to) return { reissued: false };
    throw new WorkflowError("This campus takes children in by the term, so there is no starting month to set.", "status_conflict");
  }

  // The term the child is counted under now, for its year and first day.
  const { data: current, error: intakeErr } = await admin.from("intakes").select("academic_year_id, starts_on").eq("id", app.intake_id).single();
  if (intakeErr) throw new WorkflowError(intakeErr.message, "database");
  const play = await letterInPlay(admin, app);
  const unchanged = app.start_month === to;
  if (unchanged) {
    // By the month, not the day: letters drafted before `firstSchoolDay`
    // carry the 1st even when it fell on a weekend, and are not out of date.
    const pricedFor = play.letter?.start_date ?? null;
    const upToDate = to ? pricedFor?.slice(0, 7) === to.slice(0, 7) : pricedFor === current.starts_on;
    if (!play.reDraft || upToDate) return { reissued: false };
  }

  await refuseOnceAgreed(admin, app.id, "starting month");
  if (play.reDraft && !opts.mayReprice) {
    throw new WorkflowError("This child's offer is already written. Changing the month re-drafts it, so ask someone who approves offers to change it.", "status_conflict");
  }

  // The month decides the term the application is counted under, and so the
  // academic year its fees come from: November 2026 is Term 3, 2026 and is
  // priced from the 2026 schedule, January 2027 from the 2027 one. A month
  // already saved keeps the term it was given.
  const update: { start_month: string | null; intake_id?: string } = { start_month: to };
  let academicYearId = current.academic_year_id;
  if (to && !unchanged) {
    const catalogue = await loadCatalogue(admin);
    const intake = intakeForMonth(catalogue.intakes, to);
    if (!intake) throw new WorkflowError("No open start term covers that month. Open the next year's terms under Settings → Intakes first.", "status_conflict");
    update.intake_id = intake.id;
    academicYearId = intake.academic_year_id;
  }

  if (play.reDraft) {
    const { data: grade, error: gradeErr } = await admin.from("grades").select("sort_order").eq("id", app.grade_id).single();
    if (gradeErr) throw new WorkflowError(gradeErr.message, "database");
    await requirePriceable(admin, { campusId: app.campus_id, academicYearId, gradeSort: grade.sort_order });
  }

  const say = (v: string | null) => (v ? formatMonth(v) : "not chosen");
  if (!unchanged) {
    const { error } = await admin.from("applications").update(update).eq("id", app.id);
    if (error) throw new WorkflowError(error.message, "database");
    await commit(admin, {
      applicationId: app.id,
      expectedStatus: app.status,
      newStatus: null,
      nextAction: isNextAction(app.next_action) ? app.next_action : null,
      event: {
        type: "application.start_month_set",
        summary: `Starting month ${say(app.start_month)} → ${say(to)}`,
        payload: { from: app.start_month, to, intake_id: update.intake_id ?? app.intake_id },
      },
      audit: { action: "application.start_month_set", entityType: "application", entityId: app.id },
      actor,
    });
  }

  await reissueLetter(admin, app, play, unchanged ? `Re-priced for the starting month already set, ${say(to)}` : `Starting month changed from ${say(app.start_month)} to ${say(to)}`, actor);
  return { reissued: play.reDraft };
}

/**
 * Whether the letter in play was priced at another campus than the one the
 * application names: the campus move was saved and its re-draft did not
 * happen. The schedule a letter was priced from says where.
 */
export async function letterPricedElsewhere(admin: AdminClient, play: LetterInPlay, campusId: string): Promise<boolean> {
  if (!play.reDraft || !play.letter?.fee_schedule_id) return false;
  const { data: schedule, error } = await admin.from("fee_schedules").select("campus_id").eq("id", play.letter.fee_schedule_id).maybeSingle();
  if (error) throw new WorkflowError(error.message, "database");
  return Boolean(schedule && schedule.campus_id !== campusId);
}
