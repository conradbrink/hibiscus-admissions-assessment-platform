import Link from "next/link";
import { ChevronLeft, Mail, MessageCircle } from "lucide-react";
import { ActionForm } from "@/components/staff/action-form";
import { DecisionFields } from "@/components/staff/decision-fields";
import { LaunchDialog } from "@/components/staff/launch-dialog";
import { LinkReveal } from "@/components/staff/link-reveal";
import { PriorityBadge } from "@/components/staff/status-badge";
import { SummaryPanel } from "@/components/staff/summary-panel";
import { JourneyBar } from "@/components/staff/applicant/journey-bar";
import { NextStepCard, StickyStep, type DecisionRights } from "@/components/staff/applicant/next-step-card";
import { OpenSectionLink } from "@/components/staff/applicant/open-section-link";
import {
  AssessmentPanel,
  assessmentResult,
  DecisionHistory,
  DocumentsRecord,
  offerEditorPanel,
  offerPreviewPanel,
  OfferRecord,
  shownOffer,
  PaymentRecord,
  RegistrationRecord,
  WhatsAppRecord,
  type OfferSettings,
} from "@/components/staff/applicant/records";
import { Group, PanelBlock, Row } from "@/components/staff/applicant/section";
import { StickyActionBar } from "@/components/staff/applicant/sticky-action-bar";
import { PanelHost } from "@/components/staff/applicant/modal-panel";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MobileInput } from "@/components/ui/mobile-input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatDateTime, toSchoolDateString } from "@/lib/format-date";
import { heardFromLabel } from "@/lib/heard-from";
import { can, type PermissionSet } from "@/lib/permissions";
import { isScholarshipCode } from "@/lib/promotions/scholarship";
import { isStaffDiscountCode } from "@/lib/promotions/discount";
import { monthChoices, startLabel } from "@/lib/start-month";
import { cn } from "@/lib/utils";
import { feeSnapshotFrom } from "@/lib/offers/snapshot";
import { formatMoney } from "@/lib/money";
import { canCheckIn, canMarkNoShow } from "@/lib/workflow/appointment";
import { stageLabel, stageOf, visibleViews } from "@/lib/workflow/stages";
import { canBeDecided, canTransition, isNextAction, nextActionCopy, statusAfterBooking, TERMINAL_STATUSES } from "@/lib/workflow/states";
import { defersThroughDecision, mayMoveTo, moveTargetsFor, stagesSkippedByMove } from "@/lib/workflow/stage-move";
import { startWalkIn } from "@/app/staff/(console)/assessments/actions";
import {
  addApplicantTask,
  addNote,
  assignOwner,
  assignTask,
  cancelBookingByStaff,
  changeCampus,
  checkIn,
  changeGrade,
  completeCallback,
  completeTask,
  deleteApplicant,
  generateLinkForStaff,
  markNoShow,
  recordDecision,
  refreshSummary,
  rescheduleByStaff,
  resendLink,
  setWhatsAppOptInByStaff,
  updateChildDetails,
  updateParentIdentity,
  updateParentMobile,
} from "@/app/staff/(console)/applications/[id]/actions";
import type { ApplicantWorkspace } from "@/app/staff/(console)/applications/[id]/load";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * The applicant: who they are, where they are, and what to do next.
 *
 * Read top to bottom it answers, in order: who is this (the header), where
 * are they in admissions (the journey bar), what is their status (one
 * badge), what do I do now (Next step, with its one button). The assessment
 * follows, because it is the routine work of most days. Everything else — the
 * offer letter, payments, registration, messages, documents, the history —
 * is kept behind a heading that opens, with the current stage's open.
 *
 * Every action here is one the page had before; it is the order and the
 * emphasis that changed.
 */
export function ApplicantWorkspaceView({ w, permissions }: { w: ApplicantWorkspace; permissions: PermissionSet }) {
  const { app, campus, grade, intake, contact, owner, step, booking, settings } = w;

  const canWrite = can(permissions, "applications.write");
  const canAddTask = can(permissions, "tasks.write");
  const canDelete = can(permissions, "applications.delete");
  const canDeliver = can(permissions, "assessments.deliver");
  const canDecide = can(permissions, "decisions.override");
  const terminal = TERMINAL_STATUSES.has(app.status);
  const idField = <input type="hidden" name="applicationId" value={app.id} />;

  // Whether an outcome can be recorded is the state machine's answer, not a
  // list kept here — see `canBeDecided`. A child already waitlisted can be
  // accepted or declined, not waitlisted again.
  const liveTrial = w.trials.find((t) => t.status === "invited" || t.status === "confirmed") ?? null;
  const decidable = canDecide && !terminal && canBeDecided(app.status);
  const decision: DecisionRights = {
    canRecordOutcome: decidable,
    canWaitlist: decidable && canTransition(app.status, "waitlisted"),
    canDecline: decidable && canTransition(app.status, "declined"),
    // The free trial week is a pre-school thing, one live week at a time.
    canOfferTrial: decidable && !app.requires_assessment && !liveTrial,
    hasHadTrial: w.trials.length > 0,
    autoSendOutcomes: settings.autoSendOutcomes,
    // Only one not yet under way: that is what the decline letter cancels.
    upcomingBooking: booking?.status === "booked",
  };
  // Deferring and withdrawing are not overrides of the rules engine, so they
  // keep applications.write; deferring is asked of the graph like the rest.
  // From the offer stage a deferral is the move back to Decision and then the
  // deferral (`defersThroughDecision`), so it also needs exactly what that
  // move back needs (`mayMoveTo`), and no money held — the same rules the
  // server refuses by, so the button is not offered only to say no.
  const defersBack = defersThroughDecision(app.status);
  const mayDeferBack = defersBack && mayMoveTo(permissions, "decision", "back");
  const canDefer = canWrite && !terminal && (canTransition(app.status, "deferred") || (mayDeferBack && w.moneyHeld === null));
  const canWithdraw = canWrite && !terminal;
  // Withdraw is offered everywhere Defer is not; the heading said "Defer or
  // withdraw" over a list with no Defer in it, so say why it is missing.
  const noDeferral =
    app.status === "deferred"
      ? "They are deferred already: resume them from the next step above."
      : app.status === "assessment_in_progress"
        ? "The child is sitting the assessment now. Once the sitting ends, they can be deferred."
        : app.status === "waitlisted"
          ? "A waitlisted family cannot be deferred."
          : mayDeferBack && w.moneyHeld
            ? w.moneyHeld.reason
            : defersBack
              ? `Deferring them now moves them back to Decision${w.liveOffer ? " and withdraws their offer" : ""}, and your account cannot do that.`
              : "They are past the offer, so they can no longer be deferred.";
  // The stages ahead that the officer may move the child to by hand.
  // The way back is not offered while money is held: the loader asked the
  // same rule the server refuses by (`moneyHeldReason`).
  const moveTargets = moveTargetsFor(app.status, permissions, { moneyReceived: w.moneyHeld !== null });
  // What `onDeferred` cancels: anything still booked, and a sitting arrived
  // for. A visit the family has been to stays as it is.
  const bookingWillBeCancelled = Boolean(
    booking && (booking.status === "booked" || (booking.kind === "assessment" && (booking.status === "checked_in" || booking.status === "in_progress")))
  );

  // Half day or full day, the starting month and the scholarship band: the
  // three things the next offer letter reads.
  const offerSettings: OfferSettings = {
    dayPattern:
      (grade?.sort_order ?? 999) <= 50
        ? { value: app.day_pattern, canSet: canWrite, unit: campus?.intake_cadence === "month" ? "month" : "term" }
        : null,
    startMonth: campus?.intake_cadence === "month" ? { value: app.start_month, canSet: canWrite, choices: monthChoices(toSchoolDateString(new Date())) } : null,
    // Shown to whoever may change it, and to everyone else only when there is
    // an award or a discount to see: "Scholarship: none" on every applicant is
    // noise. The staff discounts are chosen in the same box (20 October 2026).
    scholarshipBand:
      w.scholarship || isStaffDiscountCode(w.heldCode) || can(permissions, "offers.approve")
        ? {
            code: w.heldCode,
            promotionId: w.award?.promotion_id ?? null,
            isScholarship: w.scholarship,
            canSet: can(permissions, "offers.approve"),
            choices: w.bands.map((b) => b.code).filter((c): c is string => isScholarshipCode(c)),
            discounts: w.bands.map((b) => b.code).filter(isStaffDiscountCode),
          }
        : null,
  };

  const eligibleSessions = w.upcoming.filter(
    (s) =>
      s.kind === (app.requires_assessment ? "assessment" : "visit") &&
      (s.min_grade_sort === null || (grade?.sort_order ?? 0) >= s.min_grade_sort) &&
      (s.max_grade_sort === null || (grade?.sort_order ?? 0) <= s.max_grade_sort)
  );
  const campusGrades = w.campusGradeRows
    .map((r) => one(r.grades))
    .filter((g): g is { id: string; name: string; sort_order: number; is_active: boolean } => Boolean(g?.is_active))
    .sort((a, b) => a.sort_order - b.sort_order);
  const gradesAt = (campusId: string) =>
    w.allCampusGrades
      .filter((r) => r.campus_id === campusId)
      .map((r) => ({ id: r.grade_id, ...(one(r.grades) as { name: string; sort_order: number; is_active: boolean }) }))
      .filter((g) => g.is_active)
      .sort((a, b) => a.sort_order - b.sort_order);

  const nounInput = { requiresAssessment: app.requires_assessment, bookingKind: booking?.kind ?? null, scholarship: w.scholarship };
  // "No action required" says nothing staff need; only a real step is shown.
  const parentNext = isNextAction(app.next_action) && app.next_action !== "none" ? nextActionCopy(app.next_action, nounInput) : null;

  // Back to the stage this child is in, on the first of its screens this
  // person may open. A pre-school child's assessment is a visit, which the
  // check-in board does not list, so their way back is the list.
  const stage = stageOf(app.status);
  const stageView = stage
    ? visibleViews(permissions, stage).find((v) => !(stage === "assessment" && !app.requires_assessment && v.key === "today"))
    : undefined;
  const back = stage && stageView ? { href: stageView.href, label: stageLabel(stage) } : { href: "/staff/applications", label: "Admissions" };

  // Routine changes to a booking: quieter than the next step, still here.
  const noShowAllowed = canDeliver && booking ? canMarkNoShow(booking.status, booking.kind, app.status, booking.checked_in_at) : false;
  const noShowButton = (
    <ActionForm action={markNoShow} label="Mark no-show" variant="ghost" size="sm" confirm="Mark as a no-show? The parent is emailed a link to rebook.">{idField}</ActionForm>
  );
  // On the day, No-show sits beside Check in under the next step; otherwise
  // it is one of the booking's quieter tools here.
  const noShowUnderStep = step.action === "check_in" && noShowAllowed;
  // What gets booked from here: the assessment, or a visit for a family who
  // sits none (the sessions above are already that kind).
  const bookWord = app.requires_assessment ? "assessment" : w.noun;
  const bookingTools = [
    // Check in whenever there is somebody to check in, not only when it is
    // the next step: a pre-school family accepted before their visit still
    // comes, and Today's board lists assessments only.
    canDeliver && booking && canCheckIn(booking.status, app.status) && step.action !== "check_in" ? (
      <ActionForm key="check-in" action={checkIn} label="Check in" variant="outline" size="sm">{idField}</ActionForm>
    ) : null,
    noShowAllowed && !noShowUnderStep ? <span key="no-show">{noShowButton}</span> : null,
    // Booking for a family who rings, whatever the step says: a pre-school
    // enquiry waiting on a decision still books its visit here.
    // An assessment only while booking one is still the stage; a child who
    // has sat is not offered a second sitting from here.
    canWrite && !terminal && !booking && eligibleSessions.length > 0 && step.action !== "book" && (!app.requires_assessment || statusAfterBooking(app.status, "assessment") !== null) ? (
      <details key="book" className="text-sm">
        <summary className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "cursor-pointer list-none")}>Book {bookWord}</summary>
        <ActionForm action={rescheduleByStaff} label="Book selected" variant="outline" size="sm" className="mt-2 flex flex-wrap items-start gap-2 space-y-0">
          {idField}
          <NativeSelect name="sessionId" className="w-full sm:w-72" aria-label="Session">
            {eligibleSessions.map((s) => <option key={s.id} value={s.id}>{formatDateTime(s.starts_at)}{s.location ? ` · ${s.location}` : ""}</option>)}
          </NativeSelect>
        </ActionForm>
      </details>
    ) : null,
    canWrite && !terminal && booking?.status === "booked" && eligibleSessions.length > 0 ? (
      <details key="move" className="text-sm">
        <summary className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "cursor-pointer list-none")}>Move booking</summary>
        <ActionForm action={rescheduleByStaff} label="Move to selected" variant="outline" size="sm" className="mt-2 flex flex-wrap items-start gap-2 space-y-0">
          {idField}
          <NativeSelect name="sessionId" className="w-full sm:w-72" aria-label="New session">
            {eligibleSessions.map((s) => <option key={s.id} value={s.id}>{formatDateTime(s.starts_at)}{s.location ? ` · ${s.location}` : ""}</option>)}
          </NativeSelect>
        </ActionForm>
      </details>
    ) : null,
    // Also how a check-in made by mistake comes off the record (a child who
    // was checked in is never turned into a no-show) — but only while that
    // check-in is the stage. A visit the family attended stays checked in
    // for good, and cancelling it would email them about a booking they kept.
    canWrite && booking && (booking.status === "booked" || (booking.status === "checked_in" && app.status === "assessment_booked")) ? (
      <ActionForm key="cancel" action={cancelBookingByStaff} label="Cancel booking" variant="ghost" size="sm" confirm="Cancel this booking? The application stays open and the parent is emailed.">{idField}</ActionForm>
    ) : null,
    // A family at the desk with no booking: open a session for right now,
    // book, check in and launch in one press. Only while booking is the
    // stage: it used to be offered to a child who had already sat and was
    // waiting on a decision.
    canDeliver && app.requires_assessment && statusAfterBooking(app.status, "assessment") !== null && (!booking || booking.status === "booked") ? (
      <LaunchDialog key="walk-in" applicationId={app.id} childName={app.child_first_name} action={startWalkIn} walkIn />
    ) : null,
  ].filter(Boolean);
  const showAssessment = app.requires_assessment || Boolean(w.booking ?? w.lastBooking) || w.attempts.length > 0 || bookingTools.length > 0;
  const assessmentBehind = !["enquiry", "assessment", "decision"].includes(step.stage) && !booking;
  const result = assessmentResult(w);

  const latestDecision = w.decisions[0] ?? null;
  const optedIn = Boolean(contact?.whatsapp_opt_in);
  const statusVariant = step.status.tone === "default" ? "default" : step.status.tone;

  /** Less common, and some of them final: kept last, behind one heading. */
  const moreActions = () => {
    const canMoveCampus =
      canWrite &&
      !terminal &&
      ["new_enquiry", "callback_requested", "visit_booked", "assessment_booked", "no_show", "assessment_completed", "awaiting_decision", "staff_review", "deferred", "waitlisted"].includes(app.status) &&
      w.otherCampuses.length > 1;
    const canChangeStage = canWrite && app.status !== "enrolled";
    if (!canDefer && !canWithdraw && !canMoveCampus && !canChangeStage && !canDelete) return null;
    return (
      <Group title="More actions">
        <Row title="Defer, withdraw, change" meta="less common, and some of them final">
        <div className="space-y-5">
          {canDefer || canWithdraw ? (
            <div>
              <h3 className="font-semibold">{canDefer ? "Defer or withdraw" : "Withdraw"}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {canDefer
                  ? "For a family who wants a place later, or who is no longer applying. Both keep the record and the figures."
                  : `For a family who is no longer applying. It keeps the record and the figures. ${noDeferral}`}
              </p>
              <ActionForm
                action={recordDecision}
                label={canDefer ? "Save — defer or withdraw" : "Save — withdraw"}
                size="sm"
                variant="outline"
                className="mt-2 max-w-md"
                confirmBy={{
                  field: "outcome",
                  messages: {
                    deferred: [
                      "Defer this family?",
                      defersBack ? `They are moved back to Decision${w.liveOffer ? " and their offer is withdrawn" : ""}.` : null,
                      bookingWillBeCancelled ? "Their booking is cancelled and the seat goes back." : "We will message them around the date you chose.",
                    ]
                      .filter(Boolean)
                      .join(" "),
                    withdrawn: "Withdraw this application? Bookings and open tasks are cancelled.",
                  },
                }}
              >
                {idField}
                <DecisionFields
                  canRecordOutcome={false}
                  canDefer={canDefer}
                  canWithdraw={canWithdraw}
                  bookingWillBeCancelled={bookingWillBeCancelled}
                  defersThroughDecision={defersBack}
                  offerWillBeWithdrawn={defersBack && Boolean(w.liveOffer)}
                  seenStatus={app.status}
                />
              </ActionForm>
            </div>
          ) : null}

          {canMoveCampus || canChangeStage ? (
            <div className="grid gap-4 border-t border-border pt-4 md:grid-cols-2">
              {/* Bookings sit at the old campus, so a live one has to be
                  cancelled or moved first; the action says so. The stage is
                  chosen alongside, because two campuses rarely teach the same list. */}
              {canMoveCampus ? (
                <div>
                  <h3 className="font-semibold">Change campus</h3>
                  <ActionForm action={changeCampus} label="Move to campus" variant="outline" size="sm" className="mt-2" confirm="Move this family to another campus? Open tasks move with them, and the stage must be one the new campus teaches.">
                    {idField}
                    <NativeSelect name="campusId" defaultValue={app.campus_id} aria-label="Campus">
                      {w.otherCampuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </NativeSelect>
                    <NativeSelect name="gradeId" defaultValue="" aria-label="Stage at the new campus">
                      <option value="">Keep {grade?.name} if the campus teaches it</option>
                      {w.otherCampuses.flatMap((c) => gradesAt(c.id).map((g) => <option key={`${c.id}:${g.id}`} value={g.id}>{c.name} · {g.name}</option>))}
                    </NativeSelect>
                    <Input name="reason" placeholder="Why (optional)" maxLength={300} />
                    <p className="text-xs text-muted-foreground">Only before a decision. Cancel or move a live booking first.</p>
                  </ActionForm>
                </div>
              ) : null}
              {canChangeStage ? (
                <div>
                  <h3 className="font-semibold">Change stage</h3>
                  <ActionForm action={changeGrade} label="Change stage" variant="outline" size="sm" className="mt-2">
                    {idField}
                    <NativeSelect name="gradeId" defaultValue={app.grade_id} aria-label="Stage">
                      {campusGrades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </NativeSelect>
                    <Input name="reason" placeholder="Why (optional)" maxLength={300} />
                    <p className="text-xs text-muted-foreground">Decides which paper the child sits and which fees the offer uses.</p>
                  </ActionForm>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Deliberately last, and only for the permission the super
              administrator holds alone. Withdrawing is what staff want
              almost always; this is for a record that should never have existed. */}
          {canDelete ? (
            <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
              <h3 className="font-semibold text-destructive">Delete applicant</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Removes the child, the family, their documents, assessments, offers and payments. It cannot be undone; only an
                audit line remains. Use <strong>Withdraw</strong> for a family no longer applying.
              </p>
              <ActionForm action={deleteApplicant} label="Delete applicant permanently" variant="destructive" size="sm" className="mt-2 max-w-md" confirm={`Delete ${app.reference} and everything attached to it? This cannot be undone.`}>
                {idField}
                <Input name="reason" placeholder="Why is this being deleted?" required minLength={3} maxLength={300} />
                <Input name="confirm" placeholder={`Type ${app.reference} to confirm`} required pattern={app.reference} autoComplete="off" aria-label={`Type ${app.reference} to confirm`} />
              </ActionForm>
            </div>
          ) : null}
        </div>
        </Row>
      </Group>
    );
  };

  // Open tasks about this child, each assignable and closable from here, and
  // one written by hand. The campus is not asked for: a task about this child
  // belongs to the campus they applied to.
  const tasksBlock = (
    <>
      {w.openTasks.length ? (
        <ul className="space-y-2">
          {w.openTasks.map((t) => (
            <li key={t.id} className="flex flex-wrap items-start gap-3 rounded-lg border border-border p-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t.title}</p>
                {t.details ? <p className="mt-0.5 text-xs whitespace-pre-line text-muted-foreground">{t.details}</p> : null}
                {t.type === "callback" && w.callbackRequest ? (
                  <p className="mt-0.5 text-xs whitespace-pre-line">
                    Best time to call: {w.callbackRequest.preferred_time?.trim() || "not given"}
                    {w.callbackRequest.message?.trim() ? ` · “${w.callbackRequest.message.trim()}”` : ""}
                  </p>
                ) : null}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t.due_at ? `Due ${formatDateTime(t.due_at)}` : "No due date"} · {one(t.staff_profiles)?.full_name ?? "Unassigned"}
                </p>
              </div>
              <PriorityBadge priority={t.priority} />
              {canWrite ? (
                <ActionForm action={assignTask} label="Assign" size="xs" variant="outline" resetOnSubmit={false} className="flex items-center gap-1 space-y-0">
                  <input type="hidden" name="taskId" value={t.id} />
                  {idField}
                  <NativeSelect name="assigneeStaffId" defaultValue={t.assignee_staff_id ?? ""} className="h-7 w-40 py-0 text-xs md:h-7" aria-label="Assignee">
                    <option value="">Unassigned</option>
                    {w.staff.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                  </NativeSelect>
                </ActionForm>
              ) : null}
              {canWrite ? (
                t.type === "callback" && app.status === "callback_requested" ? (
                  <ActionForm action={completeCallback} label="Mark call done" size="xs" variant="success">{idField}</ActionForm>
                ) : (
                  <ActionForm action={completeTask} label="Mark task done" size="xs" variant="success">
                    <input type="hidden" name="taskId" value={t.id} />
                    {idField}
                  </ActionForm>
                )
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">Nothing open.</p>
      )}
      {w.tasks.length > w.openTasks.length ? <p className="mt-2 text-xs text-muted-foreground">{w.tasks.length - w.openTasks.length} completed</p> : null}
      {canAddTask && !terminal ? (
        <details className="mt-3 border-t border-border pt-3">
          <summary className="cursor-pointer text-xs font-medium text-primary">Add a task</summary>
          <ActionForm action={addApplicantTask} label="Add task" size="xs" className="mt-2 space-y-2">
            {idField}
            <Input name="title" placeholder="What needs doing" required minLength={3} maxLength={200} />
            <Input name="details" placeholder="Any detail (optional)" maxLength={2000} />
            <div className="grid gap-2 sm:grid-cols-3">
              <NativeSelect name="assigneeStaffId" defaultValue="" aria-label="Who it is for">
                {/* Left blank, the database gives it to this applicant's
                    owner, or the campus owner (tasks_set_default_assignee). */}
                <option value="">Their owner (automatic)</option>
                {w.staff.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </NativeSelect>
              <Input type="date" name="dueOn" aria-label="Due on" />
              <NativeSelect name="priority" defaultValue="normal" aria-label="Priority">
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </NativeSelect>
            </div>
          </ActionForm>
        </details>
      ) : null}
    </>
  );

  const offerShown = shownOffer(w);
  const offerMeta = offerShown
    ? [offerShown.status.replace("_", " "), (() => { const f = feeSnapshotFrom(offerShown.fees); return f ? `${formatMoney(f.payable_at_acceptance_minor, f.currency)} on acceptance` : null; })()].filter(Boolean).join(" · ")
    : w.offers?.length ? "withdrawn" : "not yet";
  const showPayment = w.canSeePayments && (Boolean(w.paymentRequest) || ["offer_accepted", "payment_required", "payment_processing", "paid"].includes(app.status));
  const flags = w.summary?.flags ?? [];
  const notesShown = 2;

  return (
    // The offer's letter and editor, rendered once; every Preview and Edit
    // offer button on the page opens these.
    <PanelHost panels={{ "offer-preview": offerPreviewPanel(w), "offer-edit": offerEditorPanel(w, permissions, offerSettings) }}>
      {/* 1–2. Who, and their status */}
      <header className="mb-5">
        <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          <ChevronLeft className="size-3.5" aria-hidden /> {back.label}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              {app.child_first_name} {app.child_last_name}
            </h1>
            <p className="mt-1 text-sm text-foreground/80">
              {grade?.name} · {campus?.name} · Starts {startLabel(app, { label: intake?.label ?? "" })}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              <span className="font-mono">{app.reference}</span>
              {w.lastUpdated ? <> · Last updated {formatDateTime(w.lastUpdated.at)}{w.lastUpdated.by ? ` by ${w.lastUpdated.by}` : ""}</> : null}
            </p>
          </div>
          <Badge variant={statusVariant} className="h-7 px-3 text-sm">{step.status.label}</Badge>
        </div>
        {/* What needs noticing, worked out by code from the record: a repeat
            no-show, an overdue payment, a sibling applying. The summary's
            prose said the same things at length; the flags are the part
            that changes what somebody does. */}
        {app.has_special_needs || flags.length ? (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {app.has_special_needs ? <li><Badge variant="warning">Additional needs</Badge></li> : null}
            {flags.map((f) => (
              <li key={f.kind} title={f.evidence}>
                <Badge variant={f.kind === "waiting_on_school" || f.kind === "sibling_applying" ? "secondary" : f.kind === "payment_overdue" || f.kind === "overdue_task" ? "destructive" : "warning"}>{f.label}</Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      {/* Where */}
      <JourneyBar
        stage={step.stage}
        halted={step.halted}
        done={app.status === "enrolled"}
        assessmentLabel={app.requires_assessment ? "Assessment" : w.noun === "interview" ? "Interview" : "Visit"}
        // A pre-school family can be decided without ever visiting; the bar
        // does not tick a visit that never happened. Nor a stage an officer
        // moved the child past by hand.
        skipped={[
          ...(!app.requires_assessment && !w.lastBooking && w.trials.length === 0 ? (["assessment"] as const) : []),
          ...stagesSkippedByMove(step.stage, w.milestones, w.moved),
        ]}
        milestones={w.milestones}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:grid-rows-[auto_1fr] lg:items-start">
        {/* 3–4. What to do now, and the work of the day */}
        <div className="min-w-0 space-y-5">
          <NextStepCard
            w={w}
            permissions={permissions}
            decision={decision}
            eligibleSessions={eligibleSessions}
            parentSees={parentNext ? `${parentNext.parentTitle} ${parentNext.parentDetail}` : null}
            secondary={noShowUnderStep ? noShowButton : null}
            offerSettings={offerSettings}
            moveTargets={moveTargets}
          />
          {/* The work of the day while the assessment is the stage; a record,
              one click away, once the family has moved past it. */}
          {showAssessment && !assessmentBehind ? <AssessmentPanel w={w} secondary={bookingTools.length ? bookingTools : null} /> : null}
        </div>

        {/* 5. The applicant and the people on it: one quiet panel */}
        <aside className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div className="divide-y divide-border rounded-xl border border-border bg-card p-4 text-sm [&>*]:pb-4 [&>*:last-child]:pb-0">
            <PanelBlock title="Applicant">
              <p className="font-medium">{app.child_first_name} {app.child_last_name}</p>
              <p className="text-muted-foreground">{grade?.name}{w.recommendedGrade && w.recommendedGrade.id !== app.grade_id ? ` (age suggests ${w.recommendedGrade.name})` : ""}</p>
              <p className="text-muted-foreground">{campus?.name}</p>
              <p className="text-muted-foreground">Starts {startLabel(app, { label: intake?.label ?? "" })}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Born {formatDate(app.child_date_of_birth)} · came via {app.entry_route.replace(/_/g, " ")} · heard about us: {heardFromLabel(app.heard_from, app.heard_from_detail)}
              </p>
              {/* Said by the family at enquiry. It changes how the day is
                  arranged, and it is never an input to a decision. */}
              {app.has_special_needs ? (
                <div className="mt-2 rounded-lg bg-warning/15 px-3 py-2 text-xs">
                  <p className="font-semibold text-warning-foreground">Additional needs</p>
                  <p className="mt-0.5">{app.special_needs_detail?.trim() || "The family said their child has additional needs, without details."}</p>
                  <p className="mt-1 text-muted-foreground">Arrange the sitting around it. It plays no part in the decision.</p>
                </div>
              ) : null}
            </PanelBlock>

            <PanelBlock title="Parent">
              <p className="font-medium">{contact?.first_name} {contact?.last_name}</p>
              {contact?.email ? <a href={`mailto:${contact.email}`} className="block truncate text-muted-foreground hover:text-primary hover:underline">{contact.email}</a> : null}
              <p className="text-muted-foreground">{contact?.mobile ?? "No mobile"}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                WhatsApp updates: {optedIn ? <span className="font-medium text-success">On</span> : "Off"}
                {!optedIn && contact?.whatsapp_opt_out_at ? ` since ${formatDate(contact.whatsapp_opt_out_at)}` : ""}
              </p>
              <div className="mt-2.5 flex gap-2">
                {contact?.email ? (
                  <a href={`mailto:${contact.email}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "flex-1")}>
                    <Mail aria-hidden /> Email
                  </a>
                ) : null}
                <OpenSectionLink target="communications" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "flex-1 no-underline")}>
                  <MessageCircle aria-hidden /> WhatsApp
                </OpenSectionLink>
              </div>
              {canWrite && !terminal ? (
                // Enquiry forms are filled in on phones, in a hurry: a name in
                // the wrong box, a number typed before the country was asked
                // for. Each is silent until a family says they heard nothing.
                <details className="mt-2.5 text-xs">
                  <summary className="cursor-pointer font-medium text-primary">Links and corrections</summary>
                  <div className="mt-3 space-y-3">
                    <ActionForm action={resendLink} label="Email parent a fresh link" variant="outline" size="sm">{idField}</ActionForm>
                    <LinkReveal applicationId={app.id} action={generateLinkForStaff} />
                    {w.tokens[0] ? (
                      <p className="text-muted-foreground">
                        Last link {formatDate(w.tokens[0].created_at)}, valid until {formatDate(w.tokens[0].expires_at)}, used {w.tokens[0].use_count}×
                      </p>
                    ) : null}
                    {contact?.mobile_normalised ? (
                      <ActionForm
                        action={setWhatsAppOptInByStaff}
                        label={optedIn ? "Turn WhatsApp updates off" : "Turn WhatsApp updates on"}
                        variant="ghost"
                        size="sm"
                        confirm={optedIn ? undefined : "Only if the parent asked for WhatsApp updates. Continue?"}
                      >
                        {idField}
                        <input type="hidden" name="optIn" value={optedIn ? "0" : "1"} />
                      </ActionForm>
                    ) : null}
                    <details>
                      <summary className="cursor-pointer font-medium text-primary">Correct the child&rsquo;s name or date of birth</summary>
                      <ActionForm action={updateChildDetails} label="Save the child's details" variant="outline" size="sm" className="mt-2 space-y-2">
                        {idField}
                        <div className="grid grid-cols-2 gap-2">
                          <Input name="childFirstName" defaultValue={app.child_first_name} placeholder="First name" required autoComplete="off" aria-label="Child's first name" />
                          <Input name="childLastName" defaultValue={app.child_last_name} placeholder="Surname" required autoComplete="off" aria-label="Child's surname" />
                        </div>
                        <Input name="childDateOfBirth" type="date" defaultValue={app.child_date_of_birth} required aria-label="Child's date of birth" />
                        <p className="text-muted-foreground">The name is on every letter and message. Changing the date of birth does <strong>not</strong> change the stage.</p>
                      </ActionForm>
                    </details>
                    <details>
                      <summary className="cursor-pointer font-medium text-primary">Correct the parent&rsquo;s name or email</summary>
                      <ActionForm action={updateParentIdentity} label="Save details" variant="outline" size="sm" className="mt-2 space-y-2">
                        {idField}
                        <div className="grid grid-cols-2 gap-2">
                          <Input name="firstName" defaultValue={contact?.first_name ?? ""} placeholder="First name" required autoComplete="off" aria-label="Parent's first name" />
                          <Input name="lastName" defaultValue={contact?.last_name ?? ""} placeholder="Last name" required autoComplete="off" aria-label="Parent's last name" />
                        </div>
                        <Input name="email" type="email" defaultValue={contact?.email ?? ""} placeholder="Email address" required autoComplete="off" aria-label="Parent's email address" />
                        <p className="text-muted-foreground">Changing the email sends nothing. Email a fresh link afterwards.</p>
                      </ActionForm>
                    </details>
                    <details>
                      <summary className="cursor-pointer font-medium text-primary">Correct the mobile number</summary>
                      <ActionForm action={updateParentMobile} label="Save number" variant="outline" size="sm" className="mt-2">
                        {idField}
                        <MobileInput name="mobile" defaultValue={contact?.mobile_normalised ?? contact?.mobile ?? null} required autoComplete="off" />
                      </ActionForm>
                    </details>
                  </div>
                </details>
              ) : null}
            </PanelBlock>

            <PanelBlock title="Owner">
              <p>{owner?.full_name ?? "Unassigned"}</p>
              {canWrite ? (
                <details className="mt-1 text-xs">
                  <summary className="cursor-pointer font-medium text-primary">Change</summary>
                  <ActionForm action={assignOwner} label="Assign" variant="outline" size="sm" resetOnSubmit={false} className="mt-2 flex items-center gap-2 space-y-0">
                    {idField}
                    <NativeSelect name="ownerStaffId" defaultValue={app.owner_staff_id ?? ""} aria-label="Owner" className="min-w-0 flex-1">
                      <option value="">Unassigned</option>
                      {w.staff.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                    </NativeSelect>
                  </ActionForm>
                </details>
              ) : null}
            </PanelBlock>

            <PanelBlock title={`Notes${w.notes.length ? ` · ${w.notes.length}` : ""}`} className="text-xs">
              <p className="-mt-1 mb-2 text-muted-foreground">Internal — staff only, never shown to the family.</p>
              {canWrite ? (
                <ActionForm action={addNote} label="Save note" size="xs" variant="outline">
                  {idField}
                  <Textarea name="body" rows={2} placeholder="Add a note…" required aria-label="Internal note" className="text-sm" />
                </ActionForm>
              ) : null}
              {w.notes.length ? (
                <ul className="mt-2 space-y-1.5">
                  {w.notes.slice(0, notesShown).map((n) => (
                    <li key={n.id} className="rounded-md bg-muted/60 px-2.5 py-2">
                      <p className="text-sm whitespace-pre-wrap">{n.body}</p>
                      <p className="mt-0.5 text-muted-foreground">{one(n.staff_profiles)?.full_name} · {formatDateTime(n.created_at)}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
              {w.notes.length > notesShown ? (
                <details className="mt-1.5">
                  <summary className="cursor-pointer font-medium text-primary">{w.notes.length - notesShown} earlier</summary>
                  <ul className="mt-1.5 space-y-1.5">
                    {w.notes.slice(notesShown).map((n) => (
                      <li key={n.id} className="rounded-md bg-muted/60 px-2.5 py-2">
                        <p className="text-sm whitespace-pre-wrap">{n.body}</p>
                        <p className="mt-0.5 text-muted-foreground">{one(n.staff_profiles)?.full_name} · {formatDateTime(n.created_at)}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </PanelBlock>
          </div>
        </aside>

        {/* 6–7. The records, grouped, one line each */}
        <div className="min-w-0 space-y-5 lg:col-start-1">
          <Group title="Workflow">
            {showAssessment && assessmentBehind ? (
              <Row title={app.requires_assessment ? "Assessment" : w.noun === "interview" ? "Interview" : "Visit"} meta={result ? `${result.percent}% · ${result.label}` : undefined}>
                <AssessmentPanel w={w} bare />
              </Row>
            ) : null}
            <Row title="Tasks" meta={w.openTasks.length ? `${w.openTasks.length} open` : "none open"}>
              {tasksBlock}
            </Row>
            <Row title="Decision" meta={latestDecision ? `${latestDecision.final_outcome === "approved" ? "accepted" : latestDecision.final_outcome.replace("_", " ")} · ${formatDate(latestDecision.decided_at)}` : "none yet"}>
              <DecisionHistory w={w} />
            </Row>
            {/* Closed by default: while the offer is the stage, its summary and
                buttons are already in the Next step above. */}
            <Row id="offer" title="Offer" meta={offerMeta}>
              <OfferRecord w={w} permissions={permissions} settings={offerSettings} />
            </Row>
            {showPayment ? (
              <Row title="Payment" meta={w.paymentRequest ? w.paymentRequest.status.replace("_", " ") : undefined}>
                <PaymentRecord w={w} permissions={permissions} />
              </Row>
            ) : null}
            {w.registrationState ? (
              <Row
                title="Registration"
                meta={`${Object.values(w.registrationState.sections).filter(Boolean).length} of ${Object.keys(w.registrationState.sections).length} sections done${w.registrationState.missingDocuments.length ? ` · ${w.registrationState.missingDocuments.length} document${w.registrationState.missingDocuments.length === 1 ? "" : "s"} missing` : ""}`}
              >
                <RegistrationRecord w={w} />
              </Row>
            ) : null}
          </Group>

          <Group title="Information">
            <Row title="Documents" meta="letters, receipts, reports, registration">
              <DocumentsRecord w={w} permissions={permissions} />
            </Row>
            {/* The flags are at the top of the page; this is the written
                summary behind them, and the refresh that stores them for the
                applicant list. */}
            {w.summary ? (
              <Row title="Summary" meta={w.summary.headline}>
                <SummaryPanel applicationId={app.id} view={w.summary} action={refreshSummary} bare />
              </Row>
            ) : null}
          </Group>

          <Group title="History">
            <Row title="Activity" meta={`${w.events.length} event${w.events.length === 1 ? "" : "s"}`}>
              {w.events.length ? (
                <ol className="-mx-4 -my-3 divide-y divide-border">
                  {w.events.map((e) => (
                    <li key={e.id} className="flex gap-3 px-4 py-2">
                      <span className="w-32 shrink-0 text-xs text-muted-foreground">{formatDateTime(e.occurred_at)}</span>
                      <span className="min-w-0 flex-1">
                        {e.summary}
                        <span className="ml-2 text-xs text-muted-foreground">{e.actor_type}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-muted-foreground">No events yet.</p>
              )}
            </Row>
            <Row id="communications" title="Communications" meta={`${w.messages.length} WhatsApp · ${w.emails.length} email${w.emails.length === 1 ? "" : "s"}`}>
              <div className="space-y-5">
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">WhatsApp</h3>
                    {!optedIn ? <span className="text-xs text-muted-foreground">Updates are off for this parent</span> : null}
                  </div>
                  <WhatsAppRecord w={w} permissions={permissions} />
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Email</h3>
                    {contact?.email ? (
                      <a href={`mailto:${contact.email}`} className={buttonVariants({ variant: "outline", size: "xs" })}>
                        <Mail aria-hidden /> Email parent
                      </a>
                    ) : null}
                  </div>
                  {w.emails.length ? (
                    <ul className="divide-y divide-border rounded-lg border border-border">
                      {w.emails.map((m) => (
                        <li key={m.id} className="flex items-start gap-3 px-3 py-2">
                          <span className="w-28 shrink-0 text-xs text-muted-foreground">{formatDateTime(m.sent_at ?? m.created_at)}</span>
                          <span className="min-w-0 flex-1">
                            <Link href={`/staff/admin/dev-outbox/${m.id}`} className="block truncate hover:underline">{m.subject}</Link>
                            {/* Why it did not arrive, in the provider's words: the
                                person reading is deciding whether to telephone. */}
                            {m.error ? <span className="mt-0.5 block text-xs text-destructive">{m.error}</span> : null}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {m.status}{m.opened_at ? " · opened" : ""}{m.clicked_at ? " · clicked" : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">No emails sent yet.</p>
                  )}
                </div>
              </div>
            </Row>
            {w.audit ? (
              <Row title="Audit trail" meta={`${w.audit.length} entr${w.audit.length === 1 ? "y" : "ies"}`}>
                {w.audit.length ? (
                  <ul className="-mx-4 -my-3 divide-y divide-border">
                    {w.audit.map((a) => (
                      <li key={a.id} className="flex gap-3 px-4 py-2 text-xs">
                        <span className="w-32 shrink-0 text-muted-foreground">{formatDateTime(a.occurred_at)}</span>
                        <span className="flex-1"><span className="font-mono">{a.action}</span> · {a.actor_label ?? a.actor_type}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">Nothing recorded.</p>
                )}
              </Row>
            ) : null}
          </Group>

          {moreActions()}
        </div>
      </div>

      {/* The next step, kept in reach once the card above has scrolled away. */}
      <StickyActionBar targetId="next-step">
        <StickyStep w={w} permissions={permissions} offerSettings={offerSettings} />
      </StickyActionBar>
    </PanelHost>
  );
}
