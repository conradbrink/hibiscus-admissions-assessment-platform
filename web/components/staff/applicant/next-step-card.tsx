import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { ActionForm, type StaffActionState } from "@/components/staff/action-form";
import { JumpToStep } from "@/components/staff/applicant/sticky-action-bar";
import { Badge } from "@/components/ui/badge";
import { DecisionFields } from "@/components/staff/decision-fields";
import { LaunchDialog } from "@/components/staff/launch-dialog";
import { PaymentPanel } from "@/components/staff/payment-panel";
import { TrialWeekStatus } from "@/components/staff/trial-week-status";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { can, type PermissionCode, type PermissionSet } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { NextStep, PrimaryAction } from "@/lib/workflow/next-step";
import { DecisionPanel } from "@/components/staff/applicant/decision-panel";
import { MoveStageFields } from "@/components/staff/move-stage-fields";
import { moveDirection, type MoveTarget } from "@/lib/workflow/stage-move";
import { ApproveOfferForm, assessmentResult, bandClass, OfferEditor, OfferPreview, OfferSummary, rulesRecommendation, type OfferSettings } from "@/components/staff/applicant/records";
import { generateOffer, sendOutcome, withdrawOffer } from "@/app/staff/(console)/offers/actions";
import { launchAttempt, reissueCode } from "@/app/staff/(console)/assessments/actions";
import { confirmEnrolment, confirmRegistration, sendRegistrationReminder } from "@/app/staff/(console)/registrations/actions";
import {
  addApplicantTask,
  checkIn,
  completeCallback,
  moveToStage,
  recordDecision,
  rescheduleByStaff,
  resendLink,
  resumeDeferred,
  trialWeekOutcome,
} from "@/app/staff/(console)/applications/[id]/actions";
import type { ApplicantWorkspace } from "@/app/staff/(console)/applications/[id]/load";

/**
 * NEXT STEP: the one thing to do with this applicant now, and the button
 * that does it. Directly under the header, above everything else, because it
 * is the reason staff opened the page.
 *
 * The step is worked out in `lib/workflow/next-step.ts`; this renders its
 * action with the same server actions the rest of the console uses. Where
 * the person looking does not hold the permission, the step is still said —
 * so they know whose move it is — and the button is not offered.
 */

const NEEDS: Record<PrimaryAction, { permission: PermissionCode; who: string }> = {
  call_parent: { permission: "applications.write", who: "admissions" },
  book: { permission: "applications.write", who: "admissions" },
  check_in: { permission: "assessments.deliver", who: "whoever runs assessments" },
  launch: { permission: "assessments.deliver", who: "whoever runs assessments" },
  new_code: { permission: "assessments.deliver", who: "whoever runs assessments" },
  open_sitting: { permission: "applications.read", who: "admissions" },
  mark_writing: { permission: "assessments.score.write", who: "an assessor" },
  decide: { permission: "decisions.override", who: "someone who makes admission decisions" },
  trial_outcome: { permission: "decisions.override", who: "someone who makes admission decisions" },
  generate_offer: { permission: "offers.approve", who: "someone who approves offers" },
  approve_offer: { permission: "offers.approve", who: "someone who approves offers" },
  reissue_offer: { permission: "offers.approve", who: "someone who approves offers" },
  resend_link: { permission: "applications.write", who: "admissions" },
  send_outcome: { permission: "offers.approve", who: "someone who approves offers" },
  follow_up: { permission: "tasks.write", who: "someone who can set tasks" },
  record_payment: { permission: "finance.read", who: "finance" },
  registration_reminder: { permission: "applications.write", who: "admissions" },
  confirm_registration: { permission: "applications.write", who: "admissions" },
  register: { permission: "applications.write", who: "admissions" },
  resume: { permission: "applications.write", who: "admissions" },
  withdraw: { permission: "applications.write", who: "admissions" },
};

const TONE_ACCENT: Record<NextStep["tone"], string> = {
  action: "border-l-primary",
  waiting: "border-l-info",
  paused: "border-l-muted-foreground/40",
  closed: "border-l-muted-foreground/40",
  done: "border-l-success",
};

export type DecisionRights = {
  canRecordOutcome: boolean;
  canWaitlist: boolean;
  canDecline: boolean;
  canOfferTrial: boolean;
  hasHadTrial: boolean;
  autoSendOutcomes: boolean;
  upcomingBooking: boolean;
};

export function NextStepCard({
  w,
  permissions,
  decision,
  eligibleSessions,
  parentSees,
  secondary,
  offerSettings,
  moveTargets = [],
}: {
  w: ApplicantWorkspace;
  permissions: PermissionSet;
  decision: DecisionRights;
  offerSettings: OfferSettings;
  /** The stages this person may move the child to now; empty hides Move to stage. */
  moveTargets?: readonly MoveTarget[];
  eligibleSessions: Array<{ id: string; starts_at: string; location: string | null }>;
  /** What the parent's own page tells them, so staff and family read the same thing. */
  parentSees: string | null;
  /** Small, quieter actions for this moment (a no-show, a booking to move). */
  secondary?: React.ReactNode;
}) {
  const step = w.step;
  const allowed = step.action ? can(permissions, NEEDS[step.action].permission) : false;
  const idField = <input type="hidden" name="applicationId" value={w.app.id} />;
  const main = step.tone === "waiting" ? "outline" : "default";

  // Move to stage: the officer's override, for a family who has paid already
  // or a child who need not sit. Quiet and folded, like Decide now instead,
  // because it skips steps every other button on the page waits for.
  // `moneyHeld` is set only for someone who could otherwise move the child
  // back. A block that will pass (a payment being confirmed, say) is
  // explained, with when; money received is not, because nearly every child
  // past Payment has paid, and that is no news to anyone.
  const waitToGoBack = w.moneyHeld?.passing ? w.moneyHeld.reason : null;
  const moveAside =
    moveTargets.length > 0 || waitToGoBack ? (
      <details className="mt-4 border-t border-border pt-3 text-sm">
        <summary className="cursor-pointer font-medium text-primary">Move to another stage</summary>
        {waitToGoBack ? <p className="mt-2 max-w-xl text-xs text-muted-foreground">Moving back is not available yet: {waitToGoBack}</p> : null}
        {moveTargets.length > 0 ? (
          <ActionForm
            action={moveToStage}
            label="Move child"
            size="sm"
            variant="outline"
            className="mt-3 max-w-xl space-y-3"
            confirmBy={{
              field: "target",
              // Decision and Offer can lie behind the child: then the question is
              // about the letter that is withdrawn, not the steps skipped.
              messages: {
                decision:
                  moveDirection(w.app.status, "decision") === "back"
                    ? `Move ${w.app.child_first_name} back to Decision? Their offer is withdrawn and any unpaid payment is cancelled. The parent is not emailed.`
                    : `Move ${w.app.child_first_name} to Decision without an assessment? A booked assessment is cancelled.`,
                offer:
                  moveDirection(w.app.status, "offer") === "back"
                    ? `Move ${w.app.child_first_name} back to Offer? The letter the family has is withdrawn and a new one is drafted for your approval.`
                    : `Accept ${w.app.child_first_name} and draft the offer? The skipped steps are recorded as done by you.`,
                payment: `Accept ${w.app.child_first_name}, approve the offer and record the family's acceptance? The parent is emailed what to pay.`,
                registration: `Move ${w.app.child_first_name} straight to registration? Any offer in play is withdrawn and the parent is emailed the registration form.`,
              },
            }}
          >
            {idField}
            <MoveStageFields targets={moveTargets} status={w.app.status} />
          </ActionForm>
        ) : null}
      </details>
    ) : null;

  // A decision can be recorded here even when it is not the next step: a
  // waitlisted family a place has opened for, a pre-school child decided
  // before their visit. Offered quietly, below the step.
  const decideAside =
    decision.canRecordOutcome && step.action !== "decide" && step.action !== "trial_outcome" ? (
      <details className="mt-4 border-t border-border pt-3 text-sm">
        <summary className="cursor-pointer font-medium text-primary">
          {w.app.status === "waitlisted" ? "A place has opened? Decide again" : "Decide now instead"}
        </summary>
        <div className="mt-3">
          <DecisionPanel applicationId={w.app.id} action={recordDecision} {...decision} />
        </div>
      </details>
    ) : null;

  return (
    <section
      id="next-step"
      aria-labelledby="next-step-heading"
      className={cn("surface border-l-4 p-5 sm:p-6", TONE_ACCENT[step.tone])}
    >
      <p className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">Next step</p>
      <p className="mt-2 text-sm text-muted-foreground">{step.headline}</p>
      <h2 id="next-step-heading" className="mt-0.5 flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
        {step.tone === "done" ? <CheckCircle2 className="size-6 shrink-0 text-success" aria-hidden /> : null}
        {step.title}
      </h2>
      {step.detail ? <p className="mt-1 text-sm">{step.detail}</p> : null}

      {step.action ? (
        <div className="mt-4">
          {allowed ? (
            <PrimaryActionArea action={step.action} label={step.actionLabel ?? ""} w={w} permissions={permissions} decision={decision} eligibleSessions={eligibleSessions} variant={main} idField={idField} offerSettings={offerSettings} />
          ) : (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              This is for {NEEDS[step.action].who} to do. Your account cannot {step.actionLabel?.toLowerCase() ?? "do it"}.
            </p>
          )}
        </div>
      ) : null}

      {secondary ? <div className="mt-3 flex flex-wrap items-center gap-2">{secondary}</div> : null}
      {decideAside}
      {moveAside}

      {parentSees ? (
        <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
          The parent&rsquo;s page says: &ldquo;{parentSees}&rdquo;
          {w.app.next_action_due_at ? ` · due ${formatDateTime(w.app.next_action_due_at)}` : ""}
        </p>
      ) : null}
    </section>
  );
}

function PrimaryActionArea({
  action,
  label,
  w,
  permissions,
  decision,
  eligibleSessions,
  variant,
  idField,
  offerSettings,
}: {
  offerSettings: OfferSettings;
  action: PrimaryAction;
  label: string;
  w: ApplicantWorkspace;
  permissions: PermissionSet;
  decision: DecisionRights;
  eligibleSessions: Array<{ id: string; starts_at: string; location: string | null }>;
  variant: "default" | "outline";
  idField: React.ReactNode;
}) {
  const linkButton = cn(buttonVariants({ size: "lg", variant }));
  switch (action) {
    case "call_parent":
      return (
        <div className="space-y-2">
          {w.contact?.mobile ? (
            <p className="text-sm">
              <a href={`tel:${w.contact.mobile_normalised ?? w.contact.mobile}`} className="font-semibold text-primary hover:underline">{w.contact.mobile}</a>
              {w.callbackRequest?.preferred_time?.trim() ? ` · best time: ${w.callbackRequest.preferred_time.trim()}` : ""}
            </p>
          ) : null}
          {w.callbackRequest?.message?.trim() ? <p className="text-sm text-muted-foreground">&ldquo;{w.callbackRequest.message.trim()}&rdquo;</p> : null}
          <ActionForm action={completeCallback} label={label} size="lg" variant={variant}>{idField}</ActionForm>
        </div>
      );

    case "book":
      return eligibleSessions.length ? (
        <ActionForm action={rescheduleByStaff} label={label} size="lg" variant={variant} className="flex flex-wrap items-start gap-2 space-y-0">
          {idField}
          <NativeSelect name="sessionId" className="h-9 w-full sm:w-80" aria-label="Session">
            {eligibleSessions.map((s) => (
              <option key={s.id} value={s.id}>{formatDateTime(s.starts_at)}{s.location ? ` · ${s.location}` : ""}</option>
            ))}
          </NativeSelect>
        </ActionForm>
      ) : (
        <p className="text-sm text-muted-foreground">
          No published sessions ahead at {w.campus?.name ?? "this campus"} for this stage.{" "}
          <Link href="/staff/admin/sessions" className="text-primary underline underline-offset-2">Publish sessions</Link>
        </p>
      );

    case "check_in":
      return <ActionForm action={checkIn} label={label} size="lg" variant={variant}>{idField}</ActionForm>;

    case "launch":
      return <LaunchDialog applicationId={w.app.id} childName={w.app.child_first_name} action={launchAttempt} label={label} primary />;

    case "new_code": {
      const waiting = w.latestAttempt?.status === "ready" ? w.latestAttempt : null;
      return waiting ? (
        <div className="flex flex-wrap items-center gap-3">
          <LaunchDialog applicationId={w.app.id} childName={w.app.child_first_name} action={launchAttempt} reissue={reissueCode} attemptId={waiting.id} label={label} primary />
          <Link href={`/staff/assessments/attempts/${waiting.id}`} className="text-sm text-primary underline underline-offset-2">Open the sitting</Link>
        </div>
      ) : null;
    }

    case "open_sitting":
    case "mark_writing":
      return w.latestAttempt ? (
        <Link href={`/staff/assessments/attempts/${w.latestAttempt.id}`} className={linkButton}>{label}</Link>
      ) : null;

    case "decide": {
      const result = assessmentResult(w);
      const rec = rulesRecommendation(w);
      return (
        <div className="space-y-4">
          {result || rec ? (
            <dl className="grid gap-3 rounded-lg bg-muted/60 p-3 text-sm sm:grid-cols-2">
              {result ? (
                <div>
                  <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Assessment result</dt>
                  <dd className="mt-0.5">
                    <span className="text-lg font-semibold tabular-nums">{result.percent}%</span>{" "}
                    <span className={cn("font-medium", bandClass(result.band))}>{result.label}</span>
                  </dd>
                </div>
              ) : null}
              {rec ? (
                <div>
                  <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Recommendation</dt>
                  <dd className="mt-0.5">
                    <span className="font-semibold">{rec.outcome}</span>
                    {rec.reason ? <span className="block text-xs text-muted-foreground">{rec.reason}</span> : null}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          {/* A trial week that has finished: what came of it, beside the decision it informs. */}
          {w.trials[0] ? <TrialWeekStatus applicationId={w.app.id} trial={w.trials[0]} canDecide={false} action={trialWeekOutcome} /> : null}
          <DecisionPanel applicationId={w.app.id} action={recordDecision} {...decision} />
        </div>
      );
    }

    case "trial_outcome":
      return (
        <div className="space-y-3">
          <TrialWeekStatus applicationId={w.app.id} trial={w.trials[0] ?? null} canDecide action={trialWeekOutcome} />
          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-primary">Decide now instead</summary>
            <div className="mt-3"><DecisionPanel applicationId={w.app.id} action={recordDecision} {...decision} /></div>
          </details>
        </div>
      );

    case "generate_offer":
      return (
        <div className="space-y-4">
          <div className="max-w-md"><OfferSummary w={w} settings={offerSettings} brief /></div>
          <div className="flex flex-wrap items-center gap-2">
            <ActionForm action={generateOffer} label={label} size="lg" variant={variant}>{idField}</ActionForm>
            {/* Start month, day pattern, scholarship and conditions: the letter
                reads them, so they are one click away rather than in the way. */}
            <OfferEditor w={w} permissions={permissions} settings={offerSettings} />
          </div>
        </div>
      );

    case "approve_offer":
      return (
        <div className="space-y-4">
          <div className="max-w-md"><OfferSummary w={w} settings={offerSettings} brief /></div>
          <div className="flex flex-wrap items-center gap-2">
            <ApproveOfferForm w={w} primary />
            <OfferPreview w={w} />
            <OfferEditor w={w} permissions={permissions} settings={offerSettings} />
          </div>
        </div>
      );

    case "reissue_offer":
      return w.liveOffer ? (
        <ActionForm action={withdrawOffer} label={label} size="lg" variant={variant} className="flex flex-wrap items-start gap-2 space-y-0" confirm="Withdraw the expired offer? You then create a fresh one for approval.">
          {idField}
          <input type="hidden" name="offerId" value={w.liveOffer.id} />
          <Input name="reason" defaultValue="The offer expired" className="h-9 w-full sm:w-64" required minLength={3} aria-label="Why" />
        </ActionForm>
      ) : null;

    case "resend_link":
      return (
        <div className="space-y-4">
          {w.liveOffer ? <div className="max-w-md"><OfferSummary w={w} settings={offerSettings} brief /></div> : null}
          <div className="flex flex-wrap items-center gap-2">
            <ActionForm action={resendLink} label={label} size="lg" variant={variant}>{idField}</ActionForm>
            <OfferPreview w={w} />
          </div>
        </div>
      );

    case "send_outcome":
      return (
        <ActionForm action={sendOutcome} label={label} size="lg" variant={variant} confirm={`${label}? It is emailed to the parent now.`}>
          {idField}
        </ActionForm>
      );

    case "follow_up":
      return (
        <ActionForm action={addApplicantTask} label={label} size="lg" variant={variant} className="flex flex-wrap items-end gap-2 space-y-0">
          {idField}
          <input type="hidden" name="title" value={`Follow up waitlist — ${w.app.child_first_name} ${w.app.child_last_name}`} />
          <input type="hidden" name="priority" value="normal" />
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">Follow up on</span>
            <Input type="date" name="dueOn" required className="h-9 w-44" />
          </label>
        </ActionForm>
      );

    case "record_payment":
      return w.paymentRequest ? (
        <PaymentPanel applicationId={w.app.id} request={w.paymentRequest} payments={w.payments} canWrite={can(permissions, "finance.write")} compact focus />
      ) : (
        <p className="text-sm text-muted-foreground">No payment request found; the offer may not have had fees payable on acceptance.</p>
      );

    case "registration_reminder":
      return (
        <div className="flex flex-wrap items-center gap-3">
          <ActionForm action={sendRegistrationReminder} label={label} size="lg" variant={variant}>{idField}</ActionForm>
          <Link href={`/staff/registrations/${w.app.id}`} className="text-sm text-primary underline underline-offset-2">Open the registration</Link>
        </div>
      );

    case "confirm_registration":
      return (
        <div className="flex flex-wrap items-center gap-3">
          <ActionForm action={confirmRegistration} label={label} size="lg" variant={variant} confirm={CONFIRM_REGISTRATION}>
            {idField}
          </ActionForm>
          <Link href={`/staff/registrations/${w.app.id}`} className="text-sm text-primary underline underline-offset-2">Check the registration first</Link>
        </div>
      );

    case "register":
      return (
        <div className="flex flex-wrap items-center gap-3">
          <ActionForm action={confirmEnrolment} label={label} size="lg" variant={variant} confirm="Register this child as a student? Their record is created from the registration.">
            {idField}
          </ActionForm>
          <Link href={`/staff/registrations/${w.app.id}`} className="text-sm text-primary underline underline-offset-2">Check the registration first</Link>
        </div>
      );

    case "resume":
      return (
        <div className="space-y-2">
          {w.app.deferred_reason ? <p className="text-sm text-muted-foreground whitespace-pre-line">What they said: {w.app.deferred_reason}</p> : null}
          {w.app.deferred_until ? <p className="text-xs text-muted-foreground">Coming back to them {formatDate(w.app.deferred_until)}.</p> : null}
          <ActionForm action={resumeDeferred} label={label} size="lg" variant={variant}>{idField}</ActionForm>
        </div>
      );

    case "withdraw":
      return (
        <ActionForm action={recordDecision} label={label} size="lg" variant="destructive" className="max-w-md" confirm="Withdraw this application? Bookings and open tasks are cancelled.">
          {idField}
          <DecisionFields canRecordOutcome={false} canDefer={false} canWithdraw />
        </ActionForm>
      );
  }
}

/** Steps whose whole action is one press, so the sticky bar can carry the real button. */
const ONE_PRESS: Partial<Record<PrimaryAction, (state: StaffActionState, formData: FormData) => Promise<StaffActionState>>> = {
  call_parent: completeCallback,
  check_in: checkIn,
  generate_offer: generateOffer,
  send_outcome: sendOutcome,
  resend_link: resendLink,
  registration_reminder: sendRegistrationReminder,
  confirm_registration: confirmRegistration,
  register: confirmEnrolment,
  resume: resumeDeferred,
};

const CONFIRM_REGISTRATION = "Confirm this registration for the family? The parent is emailed that everything has been received.";

/**
 * The sticky bar's contents: where the applicant is, and the same next step
 * as the card above — the real button where the step is one press, and a way
 * back to the card where it needs a form (a decision, a payment, a booking).
 */
export function StickyStep({ w, permissions, offerSettings }: { w: ApplicantWorkspace; permissions: PermissionSet; offerSettings: OfferSettings }) {
  const step = w.step;
  const allowed = step.action ? can(permissions, NEEDS[step.action].permission) : false;
  const idField = <input type="hidden" name="applicationId" value={w.app.id} />;
  const statusVariant = step.status.tone === "default" ? "default" : step.status.tone;
  const onePress = step.action ? ONE_PRESS[step.action] : undefined;

  let primary: React.ReactNode = null;
  if (step.action && step.actionLabel && allowed) {
    if (step.action === "approve_offer") primary = <ApproveOfferForm w={w} />;
    else if (onePress) primary = <ActionForm action={onePress} label={step.actionLabel} size="sm" variant={step.tone === "waiting" ? "outline" : "default"} confirm={step.action === "register" ? "Register this child as a student? Their record is created from the registration." : step.action === "confirm_registration" ? CONFIRM_REGISTRATION : step.action === "send_outcome" ? `${step.actionLabel}? It is emailed to the parent now.` : undefined}>{idField}</ActionForm>;
    else if (step.action === "launch") primary = <LaunchDialog applicationId={w.app.id} childName={w.app.child_first_name} action={launchAttempt} label={step.actionLabel} />;
    else if (step.action === "new_code" && w.latestAttempt?.status === "ready") primary = <LaunchDialog applicationId={w.app.id} childName={w.app.child_first_name} action={launchAttempt} reissue={reissueCode} attemptId={w.latestAttempt.id} label={step.actionLabel} />;
    else if ((step.action === "open_sitting" || step.action === "mark_writing") && w.latestAttempt) primary = <Link href={`/staff/assessments/attempts/${w.latestAttempt.id}`} className={buttonVariants({ size: "sm", variant: step.tone === "waiting" ? "outline" : "default" })}>{step.actionLabel}</Link>;
    else primary = <JumpToStep targetId="next-step" label={step.actionLabel} className={buttonVariants({ size: "sm", variant: step.action === "withdraw" ? "destructive" : "default" })} />;
  }

  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {step.tone === "done" ? <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden /> : <Badge variant={statusVariant} className="shrink-0">{step.status.label}</Badge>}
        <span className="truncate text-sm font-medium">{step.title}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {step.action === "approve_offer" || (step.action === "resend_link" && w.liveOffer) ? <OfferPreview w={w} /> : null}
        {step.action === "approve_offer" || step.action === "generate_offer" ? <OfferEditor w={w} permissions={permissions} settings={offerSettings} /> : null}
        {primary}
      </div>
    </>
  );
}
