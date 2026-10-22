import Link from "next/link";
import { Eye, Pencil } from "lucide-react";
import { ActionForm } from "@/components/staff/action-form";
import { MessagesPanel } from "@/components/staff/messages-panel";
import { OfferConditionsFields } from "@/components/staff/offer-conditions-fields";
import { PaymentPanel } from "@/components/staff/payment-panel";
import { TrialWeekStatus } from "@/components/staff/trial-week-status";
import { BookingBadge } from "@/components/staff/status-badge";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { BAND_LABELS } from "@/lib/assessment/bands";
import { formatDate, formatDateLong, formatDateTime, formatTime } from "@/lib/format-date";
import { saysAssessment } from "@/lib/messaging/template-checks";
import { formatMoney } from "@/lib/money";
import { feeLinesFor, feeSnapshotFrom } from "@/lib/offers/snapshot";
import { can, type PermissionSet } from "@/lib/permissions";
import type { ComputedProfile } from "@/lib/profile/compute";
import { NARRATIVE_SCHEMA } from "@/lib/profile/narrative";
import type { PromotionFeeSnapshot } from "@/lib/promotions/apply";
import { awardLabelOf } from "@/lib/promotions/scholarship";
import { discountLabelOf, isStaffDiscountCode } from "@/lib/promotions/discount";
import { SECTION_LABELS, SECTIONS } from "@/lib/registration/completeness";
import type { RuleResult } from "@/lib/rules/evaluate";
import { formatMonth, startLabel, type MonthChoice } from "@/lib/start-month";
import type { BenchmarkBand } from "@/lib/supabase/types";
import { APPOINTMENT_LABELS, APPOINTMENT_STATE, APPOINTMENT_STEPS } from "@/lib/workflow/appointment";
import { cn } from "@/lib/utils";
import { approveOffer, generateOffer, withdrawOffer } from "@/app/staff/(console)/offers/actions";
import { sendWhatsAppTemplate, setDayPattern, setScholarship, setStartMonth, trialWeekOutcome } from "@/app/staff/(console)/applications/[id]/actions";
import type { ApplicantWorkspace } from "@/app/staff/(console)/applications/[id]/load";
import { PanelButton, type PanelSpec } from "@/components/staff/applicant/modal-panel";

/**
 * The records behind each stage of the journey, for the applicant page's
 * collapsible sections. What used to be eight tabs (Assessment, Learning
 * profile, Decision, Offer, Payment, Registration, WhatsApp, Downloads) is
 * here unchanged in substance; the page decides which are open.
 */

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

// Static class names: Tailwind only emits classes it can see in the source.
export const bandClass = (band: string) =>
  band === "exceeding" || band === "meeting" ? "text-success" : band === "approaching" ? "text-warning-foreground" : "text-destructive";

const OUTCOME_WORD: Record<string, string> = {
  approved: "Accept",
  waitlisted: "Waitlist",
  declined: "Decline",
  staff_review: "Refer to a person",
};

/** The overall score and band of the newest sitting, or null before it is marked. */
export function assessmentResult(w: ApplicantWorkspace): { percent: number; band: string; label: string } | null {
  const overall = w.scores.find((s) => s.scope === "overall");
  if (!overall) return null;
  return { percent: Number(overall.percent), band: overall.band, label: BAND_LABELS[overall.band as BenchmarkBand] ?? overall.band };
}

/** What the admission rules said, if they ran: the recommendation a person decides against. */
export function rulesRecommendation(w: ApplicantWorkspace): { outcome: string; reason: string | null } | null {
  const rules = w.decisions.find((d) => d.decided_by === "rules");
  if (!rules) return null;
  const inputs = (rules.inputs ?? {}) as { reason?: string };
  return { outcome: OUTCOME_WORD[rules.computed_outcome] ?? rules.computed_outcome, reason: inputs.reason ?? null };
}

function scopeName(w: ApplicantWorkspace, scope: string, id: string | null) {
  return scope === "overall"
    ? "Overall"
    : scope === "subject"
      ? (w.subjects.find((s) => s.id === id)?.name ?? "?")
      : (w.competencies.find((c) => c.id === id)?.name ?? "?");
}

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

/**
 * The appointment and the sitting: when, where, how far it got, and the
 * result. Routine changes to the booking sit here as small buttons; the one
 * thing to do next is in the Next step card above, never repeated here.
 */
export function AssessmentPanel({ w, secondary, bare = false }: { w: ApplicantWorkspace; secondary?: React.ReactNode; /** Inside a collapsed section, which has its own card and heading. */ bare?: boolean }) {
  const live = w.booking;
  const shown = live ?? w.lastBooking;
  const session = live ? w.bookingSession : w.lastSession;
  const appt = shown ? APPOINTMENT_STATE[shown.status] : null;
  const Noun = w.noun.charAt(0).toUpperCase() + w.noun.slice(1);
  const result = assessmentResult(w);

  return (
    <section className={bare ? "text-sm" : "surface p-4 text-sm"} aria-labelledby={bare ? undefined : "assessment-heading"}>
      <div className="flex flex-wrap items-center gap-2">
        {bare ? null : <h2 id="assessment-heading" className="text-sm font-semibold">{Noun}</h2>}
        {shown ? <BookingBadge status={shown.status} /> : null}
        {result ? (
          <span className="ml-auto text-sm">
            Result <span className="font-semibold tabular-nums">{result.percent}%</span> ·{" "}
            <span className={cn("font-medium", bandClass(result.band))}>{result.label}</span>
          </span>
        ) : null}
      </div>

      {shown && session ? (
        <p className="mt-1 text-muted-foreground">
          <span className="font-medium text-foreground">{formatDateLong(session.starts_at)} · {formatTime(session.starts_at)}</span>
          {" · "}
          {one(session.campuses)?.name}
          {session.location ? ` · ${session.location}` : ""}
          {shown.checked_in_at ? ` · arrived ${formatTime(shown.checked_in_at)}` : ""}
        </p>
      ) : (
        <p className="mt-1 text-muted-foreground">Nothing booked yet.</p>
      )}

      {/* Where the appointment is. One track or the other, never both: a
          booking that was missed never shows as arrived, and the reverse. */}
      {appt && appt !== "cancelled" && appt !== "moved" ? (
        <ol className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs" aria-label="Appointment">
          {(appt === "no_show" ? (["booked", "no_show"] as const) : APPOINTMENT_STEPS).map((s, i, all) => {
            const at = all.indexOf(appt);
            const state = i < at ? "done" : i === at ? "now" : "todo";
            return (
              <li key={s} className="flex items-center gap-1.5">
                {i > 0 ? <span className="text-muted-foreground" aria-hidden>→</span> : null}
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5",
                    state === "now" && (s === "no_show" ? "bg-destructive/10 font-semibold text-destructive" : "bg-primary/10 font-semibold text-primary"),
                    state === "done" && "text-foreground",
                    state === "todo" && "text-muted-foreground"
                  )}
                >
                  {APPOINTMENT_LABELS[s]}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}

      {w.attempts.length ? (
        <ul className="mt-3 space-y-2">
          {w.attempts.map((at) => (
            <li key={at.id} className="rounded-lg border border-border p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/staff/assessments/attempts/${at.id}`} className="font-medium hover:underline">
                  Sitting on {formatDate(at.launched_at)}
                </Link>
                <Badge variant={at.status === "marked" ? "success" : at.status === "abandoned" ? "secondary" : "info"}>{at.status.replace("_", " ")}</Badge>
                {at.status === "submitted" ? (
                  <Badge variant={at.marking_status === "awaiting_rubric" ? "warning" : "secondary"}>{at.marking_status.replace("_", " ")}</Badge>
                ) : null}
                {at.marking_status === "complete" ? (
                  <a href={`/staff/assessments/attempts/${at.id}/report`} target="_blank" rel="noopener" className="ml-auto text-xs font-medium text-primary hover:underline">
                    Report (PDF)
                  </a>
                ) : null}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {at.started_at ? `Started ${formatDateTime(at.started_at)}` : "Not started"}
                {at.submitted_at ? ` · handed in ${formatDateTime(at.submitted_at)}` : ""}
                {at.auto_submitted ? " · handed in automatically at the time limit" : ""}
                {at.time_multiplier !== 1 ? ` · ${at.time_multiplier}× time${at.accommodation_note ? `: ${at.accommodation_note}` : ""}` : ""}
              </p>
              {at.id === w.latestAttempt?.id && w.scores.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[...w.scores]
                    .sort((x, y) => (x.scope === "overall" ? -1 : y.scope === "overall" ? 1 : x.scope.localeCompare(y.scope)))
                    .map((s) => (
                      <span key={`${s.scope}:${s.scope_id}`} className="rounded-md border border-border px-2 py-0.5 text-xs">
                        {scopeName(w, s.scope, s.scope_id)} {s.percent}% · <span className={bandClass(s.band)}>{BAND_LABELS[s.band as BenchmarkBand] ?? s.band}</span>
                      </span>
                    ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {w.app.requires_assessment ? <LearningProfile w={w} /> : null}

      {secondary ? <div className="mt-3 flex flex-wrap items-start gap-2 border-t border-border pt-3">{secondary}</div> : null}
    </section>
  );
}

function LearningProfile({ w }: { w: ApplicantWorkspace }) {
  const profile = w.profile;
  const computed = profile ? (profile.computed as unknown as ComputedProfile) : null;
  const narrative = profile ? NARRATIVE_SCHEMA.safeParse(profile.narrative) : null;
  if (!profile || !computed || !narrative?.success) return null;
  return (
    <details className="mt-3 rounded-lg border border-border px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium">Learning profile</summary>
      <div className="mt-2 space-y-3">
        <p className="text-xs text-muted-foreground">
          {profile.published_at ? `Published ${formatDateTime(profile.published_at)}` : "Not published"} ·{" "}
          {profile.narrative_source === "ai"
            ? `AI narrative (${profile.ai_model ?? "model"}), validation ${profile.validation_status}`
            : `standard wording${profile.validation_status === "failed" ? " because the AI text failed validation" : ""}`}
        </p>
        <p>{narrative.data.summary}</p>
        {narrative.data.strengths_text ? <p><span className="font-medium">Strengths.</span> {narrative.data.strengths_text}</p> : null}
        {narrative.data.development_text ? <p><span className="font-medium">Next steps.</span> {narrative.data.development_text}</p> : null}
        <div className="grid gap-2 sm:grid-cols-2">
          {computed.subjects.map((s) => (
            <div key={s.id} className="rounded-lg border border-border p-2">
              <p className="flex justify-between font-medium"><span>{s.name}</span><span className="tabular-nums">{s.percent}%</span></p>
              <ul className="mt-1 text-xs text-muted-foreground">
                {computed.competencies.filter((c) => c.subjectId === s.id).map((c) => (
                  <li key={c.id} className="flex justify-between"><span>{c.name}</span><span>{c.percent}% · {BAND_LABELS[c.band]}</span></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">The parent reads this at their profile link. Bands are the school&rsquo;s benchmarks; the wording never diagnoses or ranks.</p>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Decision history
// ---------------------------------------------------------------------------

export function DecisionHistory({ w }: { w: ApplicantWorkspace }) {
  // How a finished trial week went is part of why the child was decided the
  // way they were; the old Decision tab put it above the decisions.
  const finishedTrial = w.trials[0] && w.trials[0].status !== "invited" && w.trials[0].status !== "confirmed" ? w.trials[0] : null;
  const trial = finishedTrial ? <TrialWeekStatus applicationId={w.app.id} trial={finishedTrial} canDecide={false} action={trialWeekOutcome} /> : null;
  if (!w.decisions.length) return <>{trial}<p className={trial ? "mt-3 text-muted-foreground" : "text-muted-foreground"}>No decision yet.</p></>;
  return (
    <>
    {trial}
    <ol className={trial ? "mt-3 space-y-2" : "space-y-2"}>
      {w.decisions.map((d) => {
        const inputs = (d.inputs ?? {}) as { results?: RuleResult[]; reason?: string; places_remaining?: number | null };
        const failing = (inputs.results ?? []).filter((r) => r.effect !== "pass");
        return (
          <li key={d.id} className="rounded-lg border border-border p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={d.final_outcome === "approved" ? "success" : d.final_outcome === "declined" ? "destructive" : "warning"}>
                {OUTCOME_WORD[d.final_outcome] === "Accept" ? "Accepted" : d.final_outcome.replace("_", " ")}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {d.decided_by === "rules" ? `Admission rules${d.ruleset_version ? ` (v${d.ruleset_version})` : ""}` : (one(d.staff_profiles)?.full_name ?? "Staff")} · {formatDateTime(d.decided_at)}
              </span>
              {d.computed_outcome !== d.final_outcome ? <span className="text-xs text-muted-foreground">rules said {d.computed_outcome.replace("_", " ")}</span> : null}
            </div>
            {d.override_reason ? <p className="mt-1">{d.override_reason}</p> : null}
            {inputs.reason ? <p className="mt-1 text-xs text-muted-foreground">{inputs.reason}</p> : null}
            {typeof inputs.places_remaining === "number" ? <p className="mt-1 text-xs text-muted-foreground">Places remaining at the time: {inputs.places_remaining}</p> : null}
            {failing.length ? (
              <ul className="mt-1 text-xs text-muted-foreground">
                {failing.map((f, i) => <li key={i}>{f.effect.replace("_", " ")}: {f.rule.label}{f.actual !== null ? ` (actual ${f.actual}%)` : ""}</li>)}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ol>
    </>
  );
}

// ---------------------------------------------------------------------------
// Offer
// ---------------------------------------------------------------------------

export type OfferSettings = {
  dayPattern: { value: "half" | "full" | null; canSet: boolean; unit: "term" | "month" } | null;
  startMonth: { value: string | null; canSet: boolean; choices: MonthChoice[] } | null;
  scholarshipBand: {
    code: string | null;
    promotionId: string | null;
    isScholarship: boolean;
    canSet: boolean;
    choices: string[];
    /** The staff discounts on offer beside the bands: `DISCOUNT-5`. */
    discounts: string[];
  } | null;
};

/** The letter and the three things that decide what it says: the starting month, the day pattern and the scholarship. */
/** Where the child starts, as the letter will say it: the chosen month at a monthly campus, otherwise the term. */
export function offerStart(w: ApplicantWorkspace, settings: OfferSettings): string {
  return settings.startMonth?.value ? formatMonth(settings.startMonth.value) : startLabel(w.app, { label: w.intake?.label ?? "" });
}

function scholarshipText(band: OfferSettings["scholarshipBand"]): string {
  if (!band) return "None";
  return band.isScholarship ? `${awardLabelOf(band.code)} of tuition` : band.code ? `None (holds the ${band.code} deal)` : "None";
}

/**
 * The offer at a glance: when the child starts, the day pattern, any
 * scholarship, and what the letter charges. `brief` keeps it to the three
 * lines the Next step needs: start, tuition, and what is payable to accept.
 */
/**
 * The letter worth showing: the one in play, or once the family has said yes
 * the one they accepted (no longer "live", but still what they are paying).
 */
export function shownOffer(w: ApplicantWorkspace) {
  return w.liveOffer ?? (w.offers ?? []).find((o) => o.status === "accepted") ?? null;
}

export function OfferSummary({ w, settings, brief = false }: { w: ApplicantWorkspace; settings: OfferSettings; brief?: boolean }) {
  const offer = shownOffer(w);
  const fees = offer ? feeSnapshotFrom(offer.fees) : null;
  // A letter that has gone out is read from what it froze, not from the
  // application today: staff may since have changed the month or the day
  // pattern, and the parent's letter still says what it said. A draft or a
  // letter awaiting approval is rendered again at approval, so it follows
  // the current settings.
  const frozen = Boolean(offer && offer.status !== "draft" && offer.status !== "pending_approval");
  const vars = (frozen && offer?.variables && typeof offer.variables === "object" ? offer.variables : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof vars[k] === "string" && vars[k] ? (vars[k] as string) : null);
  const row = (label: string, value: React.ReactNode, strong = false) => (
    <div key={label} className="flex items-baseline justify-between gap-4 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("text-right tabular-nums", strong && "font-semibold")}>{value}</dd>
    </div>
  );

  let feeRows: React.ReactNode[] = [];
  let payable: string | null = null;
  if (fees && frozen) {
    const tuition: Array<[string, string | null]> = [
      ["Monthly tuition", str("tuition_month")],
      ["Monthly tuition, half day", str("tuition_month_half")],
      ["Monthly tuition, full day", str("tuition_month_full")],
      ["Term tuition", str("tuition_term")],
      ["Term tuition, half day", str("tuition_term_half")],
      ["Term tuition, full day", str("tuition_term_full")],
    ];
    feeRows = [
      ...tuition.filter(([, v]) => v).map(([label, v]) => row(label, v)),
      ...(brief ? [] : fees.lines.filter((l) => !l.code.startsWith("tuition")).map((l) => row(l.label, formatMoney(l.amount_minor, fees.currency)))),
    ];
    payable = str("amount_due") ?? formatMoney(fees.payable_at_acceptance_minor, fees.currency);
  } else if (fees) {
    const lines = feeLinesFor(fees, settings.dayPattern?.value ?? null);
    feeRows = (brief ? lines.filter((l) => l.code.startsWith("tuition")) : lines).map((l) => row(l.label, formatMoney(l.amount_minor, fees.currency)));
    payable = formatMoney(fees.payable_at_acceptance_minor, fees.currency);
  }
  const letterCode = frozen ? ((fees as PromotionFeeSnapshot | null)?.promotion?.code ?? null) : null;
  const letterScholarship = frozen ? awardLabelOf(letterCode) : null;
  // A staff discount is a line of its own: "Scholarship: none" beside it
  // would read as if the family had been refused something.
  const discount = frozen ? discountLabelOf(letterCode) : discountLabelOf(w.heldCode);

  return (
    <dl className="divide-y divide-border/60 text-sm">
      {row("Starts", (frozen && str("intake")) || offerStart(w, settings))}
      {!brief && !frozen && settings.dayPattern ? row("Attendance", settings.dayPattern.value === "half" ? "Half day" : settings.dayPattern.value === "full" ? "Full day" : "Not decided — both rates quoted") : null}
      {!brief && discount ? row("Discount", discount) : null}
      {!brief && !discount && (frozen ? row("Scholarship", letterScholarship ? `${letterScholarship} of tuition` : "None") : settings.scholarshipBand || w.heldCode ? row("Scholarship", scholarshipText(settings.scholarshipBand)) : null)}
      {fees ? (
        <>
          {feeRows}
          {row("Payable on acceptance", payable, true)}
        </>
      ) : offer ? (
        row(
          "Fees",
          <span className="text-warning-foreground">
            No fee schedule covers this campus, stage and year, so the offer cannot be sent.{" "}
            <Link href="/staff/admin/fees" className="text-primary underline underline-offset-2">Configure fees</Link>
          </span>
        )
      ) : null}
      {!brief && offer?.conditions ? row("Conditions", offer.conditions) : null}
      {!brief && frozen && offer
        ? row(
            "Letter",
            offer.status === "accepted"
              ? `accepted${offer.sent_at ? ` (sent ${formatDate(offer.sent_at)})` : ""}`
              : [offer.sent_at ? `sent ${formatDate(offer.sent_at)}` : null, offer.first_viewed_at ? `opened ${formatDate(offer.first_viewed_at)}` : "not opened", offer.expires_at ? `open until ${formatDate(offer.expires_at)}` : null]
                  .filter(Boolean)
                  .join(" · ")
          )
        : null}
    </dl>
  );
}

/** The letter exactly as the parent reads it: the panel's content, rendered once by the page. */
export function offerPreviewPanel(w: ApplicantWorkspace): PanelSpec | null {
  const offer = shownOffer(w);
  if (!offer) return null;
  return {
    title: "The offer as the parent reads it",
    wide: true,
    content: <div className="prose prose-sm max-w-none rounded-lg border border-border bg-background p-4" dangerouslySetInnerHTML={{ __html: offer.rendered_html + offer.terms_html }} />,
  };
}

/** Opens the letter preview, where there is a letter. */
export function OfferPreview({ w }: { w: ApplicantWorkspace }) {
  return shownOffer(w) ? <PanelButton name="offer-preview" label="Preview" icon={<Eye aria-hidden />} /> : null;
}

/** Opens the offer editor, for whoever may change something in it. */
export function OfferEditor({ w, permissions, settings }: { w: ApplicantWorkspace; permissions: PermissionSet; settings: OfferSettings }) {
  return canEditOffer(w, permissions, settings) ? <PanelButton name="offer-edit" label="Edit offer" icon={<Pencil aria-hidden />} /> : null;
}

function canEditOffer(w: ApplicantWorkspace, permissions: PermissionSet, settings: OfferSettings): boolean {
  return can(permissions, "offers.approve") || Boolean(settings.startMonth?.canSet || settings.dayPattern?.canSet || settings.scholarshipBand?.canSet);
}

/**
 * Everything that changes what the next letter says, one click away: the
 * starting month, half or full day, the scholarship, the conditions, and
 * withdrawing a letter to correct it.
 */
export function offerEditorPanel(w: ApplicantWorkspace, permissions: PermissionSet, settings: OfferSettings): PanelSpec | null {
  if (!canEditOffer(w, permissions, settings)) return null;
  const { dayPattern, startMonth, scholarshipBand } = settings;
  const canApprove = can(permissions, "offers.approve");
  const liveOffer = w.liveOffer;
  const offers = w.offers;
  // The most recent letter of any status: a withdrawn one is not live, and
  // withdrawing is exactly what staff are told to do before re-pricing.
  const newestOffer = (offers ?? [])[0] ?? null;
  const bandMovedSinceOffer = Boolean(newestOffer && scholarshipBand && newestOffer.promotion_id !== scholarshipBand.promotionId);
  // Saving the scholarship re-drafts the letter (`setScholarship`): these say
  // which way, so the button and its line can say so before it is pressed.
  const letterWithFamily = Boolean(liveOffer && ["sent", "viewed", "expired"].includes(liveOffer.status));
  const acceptedOffer = (offers ?? []).some((o) => o.status === "accepted");
  const pricedUnderCode = (feeSnapshotFrom(newestOffer?.fees) as PromotionFeeSnapshot | null)?.promotion?.code ?? null;
  const offerPricedUnder = discountLabelOf(pricedUnderCode) ?? awardLabelOf(pricedUnderCode);
  // A scholarship band or a staff discount: both are chosen in the one box,
  // and a child holding either starts on it rather than on "keep".
  const pickable = Boolean(scholarshipBand && (scholarshipBand.isScholarship || isStaffDiscountCode(scholarshipBand.code)));
  const dealWord = scholarshipBand?.discounts.length ? "scholarship or discount" : "scholarship";
  const idField = <input type="hidden" name="applicationId" value={w.app.id} />;
  // Conditions are given when a letter is drafted: on the draft or the one
  // waiting for approval, or when there is none yet and one can be created.
  const canDraft = canApprove && (liveOffer ? liveOffer.status === "draft" || liveOffer.status === "pending_approval" : ["approved", "offer_draft"].includes(w.app.status));
  const field = "space-y-2 border-t border-border pt-4 first:border-t-0 first:pt-0";

  return {
    title: "Edit offer",
    description: "What the next letter says. A letter already sent keeps what it was drafted with.",
    content: (
      <div className="space-y-4">
        {startMonth?.canSet ? (
          <ActionForm
            action={setStartMonth}
            label={letterWithFamily ? "Save and re-issue the offer" : liveOffer?.status === "pending_approval" ? "Save and re-draft the offer" : "Save starting month"}
            variant="outline"
            size="sm"
            className={field}
            confirm={letterWithFamily ? "The letter the family has is withdrawn, and a new one for this month waits for your approval. Continue?" : undefined}
          >
            {idField}
            <label className="block text-xs font-semibold text-muted-foreground" htmlFor="startMonth">Starting month</label>
            <NativeSelect id="startMonth" name="startMonth" defaultValue={startMonth.value ?? ""}>
              <option value="">Not chosen — the letter names the term</option>
              {startMonth.value && !startMonth.choices.some((c) => c.value === startMonth.value) ? <option value={startMonth.value}>{formatMonth(startMonth.value)}</option> : null}
              {startMonth.choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </NativeSelect>
          </ActionForm>
        ) : null}
        {dayPattern?.canSet ? (
          <ActionForm action={setDayPattern} label="Save attendance" variant="outline" size="sm" className={field}>
            {idField}
            <label className="block text-xs font-semibold text-muted-foreground" htmlFor="dayPattern">Full or half day</label>
            <NativeSelect id="dayPattern" name="dayPattern" defaultValue={dayPattern.value ?? ""}>
              <option value="">Not decided — the letter quotes both rates</option>
              <option value="half">Half day</option>
              <option value="full">Full day</option>
            </NativeSelect>
            <p className="text-xs text-muted-foreground">Decides which {dayPattern.unit === "month" ? "monthly" : "term"} fee the next letter quotes.</p>
          </ActionForm>
        ) : null}
        {scholarshipBand?.canSet ? (
          <ActionForm
            action={setScholarship}
            label={letterWithFamily ? "Save and re-issue the offer" : liveOffer ? "Save and re-draft the offer" : `Save ${dealWord}`}
            variant="outline"
            size="sm"
            className={field}
            confirm={letterWithFamily ? `The letter the family has is withdrawn, and a new one at this ${dealWord} waits for your approval. Continue?` : undefined}
          >
            {idField}
            <label className="block text-xs font-semibold text-muted-foreground" htmlFor="scholarship">
              {scholarshipBand.discounts.length ? "Scholarship or discount" : "Scholarship"}
            </label>
            {bandMovedSinceOffer ? (
              <p className="rounded-lg bg-warning/15 px-2 py-1.5 text-xs text-warning-foreground">
                {offerPricedUnder ? `The most recent letter was priced at ${offerPricedUnder}, not this. ` : "The most recent letter was priced under a different deal. "}
                {acceptedOffer ? "The family accepted that letter, so it keeps its fees." : liveOffer ? "Re-draft the offer to re-price it." : "Nothing is drafted now — create an offer to issue one at this band."}
              </p>
            ) : null}
            <NativeSelect id="scholarship" name="code" defaultValue={pickable ? (scholarshipBand.code ?? "") : scholarshipBand.code ? "keep" : ""}>
              {/* A child on an ordinary deal starts on "keep", so saving
                  without choosing cannot take the deal off them. */}
              {scholarshipBand.code && !pickable ? <option value="keep">Keep the {scholarshipBand.code} deal</option> : null}
              <option value="">{scholarshipBand.code && !pickable ? `Remove the ${scholarshipBand.code} deal` : `No ${dealWord}`}</option>
              {scholarshipBand.discounts.length ? (
                <>
                  <optgroup label="Scholarship">
                    {scholarshipBand.choices.map((c) => <option key={c} value={c}>{awardLabelOf(c)}</option>)}
                  </optgroup>
                  <optgroup label="Discount">
                    {scholarshipBand.discounts.map((c) => <option key={c} value={c}>{discountLabelOf(c)}</option>)}
                  </optgroup>
                </>
              ) : (
                scholarshipBand.choices.map((c) => <option key={c} value={c}>{awardLabelOf(c)}</option>)
              )}
            </NativeSelect>
            <Input name="reason" placeholder="Why (optional)" maxLength={500} aria-label={`Why the ${dealWord} changed`} />
            <p className="text-xs text-muted-foreground">
              {letterWithFamily
                ? `Saving withdraws the letter the family has and drafts a new one at this ${dealWord}, for your approval.`
                : liveOffer?.status === "pending_approval"
                  ? `Saving re-drafts the offer at this ${dealWord}. It still waits for approval.`
                  : acceptedOffer
                    ? `The family has accepted their letter, which keeps its fees. Saving changes only the ${dealWord} on file.`
                    : "Decides the tuition the next letter quotes."}
              {scholarshipBand.discounts.length ? " A discount takes that much off tuition only; the other fees stay as they are." : ""}
              {scholarshipBand.code && !pickable
                ? " Awarding a scholarship replaces the deal; there is only ever one."
                : scholarshipBand.discounts.length
                  ? " A child holds a scholarship or a discount, never both."
                  : ""}
            </p>
          </ActionForm>
        ) : null}
        {canDraft ? (
          <ActionForm
            action={generateOffer}
            label={liveOffer ? "Re-draft offer with these conditions" : "Create offer with these conditions"}
            variant="outline"
            size="sm"
            className={field}
            confirm={liveOffer ? "Re-draft this offer? It still waits for approval." : undefined}
          >
            {idField}
            <OfferConditionsFields grades={w.grades} currentGradeSort={w.grade?.sort_order ?? 0} compact />
          </ActionForm>
        ) : null}
        {canApprove && liveOffer && liveOffer.status !== "expired" ? (
          // Withdrawing is a correction, not the next step: it sits here,
          // quietly, rather than beside Approve.
          <ActionForm action={withdrawOffer} label="Withdraw offer to correct it" size="sm" variant="ghost" className={field} confirm="Withdraw this offer? The parent's link stops working and a corrected one can be issued.">
            {idField}<input type="hidden" name="offerId" value={liveOffer.id} />
            <label className="block text-xs font-semibold text-muted-foreground" htmlFor="withdrawReason">Withdraw this letter</label>
            <Input id="withdrawReason" name="reason" placeholder="Why" required minLength={3} />
          </ActionForm>
        ) : null}
        {offers && offers.filter((o) => o.id !== liveOffer?.id).length ? (
          <div className={field}>
            <p className="text-xs font-semibold text-muted-foreground">Earlier offers</p>
            <ul className="text-xs text-muted-foreground">
              {offers.filter((o) => o.id !== liveOffer?.id).map((o) => (
                <li key={o.id}>{o.status} · drafted {formatDate(o.created_at)}{o.withdrawn_reason ? ` · ${o.withdrawn_reason}` : ""}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {canApprove ? <Link href="/staff/offers" className="inline-block text-xs text-primary underline underline-offset-2">All offers</Link> : null}
      </div>
    ),
  };
}

/** The Offer row in the page's workflow group: the summary and the two buttons. */
export function OfferRecord({ w, permissions, settings }: { w: ApplicantWorkspace; permissions: PermissionSet; settings: OfferSettings }) {
  if (w.offers === null) return <p className="text-muted-foreground">You do not have permission to see offers.</p>;
  return (
    <div className="space-y-3">
      <OfferSummary w={w} settings={settings} />
      {!shownOffer(w) ? (
        <p className="text-xs text-muted-foreground">
          {w.offers.length ? `${w.offers.length} earlier offer${w.offers.length === 1 ? "" : "s"} withdrawn. ` : ""}
          {w.app.status === "waitlisted" || w.app.status === "declined" ? "No offer for this outcome." : "No offer yet; one is drafted when the applicant is accepted."}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <OfferPreview w={w} />
        <OfferEditor w={w} permissions={permissions} settings={settings} />
      </div>
    </div>
  );
}

/** The approve button the Next step uses, kept beside the rest of the offer's actions. */
export function ApproveOfferForm({ w, primary }: { w: ApplicantWorkspace; primary?: boolean }) {
  if (!w.liveOffer || w.liveOffer.status !== "pending_approval") return null;
  return (
    <ActionForm action={approveOffer} label="Approve & send offer" size={primary ? "lg" : "sm"} confirm="Send this offer to the parent now?">
      <input type="hidden" name="applicationId" value={w.app.id} />
      <input type="hidden" name="offerId" value={w.liveOffer.id} />
    </ActionForm>
  );
}

// ---------------------------------------------------------------------------
// Payment, registration, documents, WhatsApp
// ---------------------------------------------------------------------------

export function PaymentRecord({ w, permissions }: { w: ApplicantWorkspace; permissions: PermissionSet }) {
  if (!w.canSeePayments) return <p className="text-muted-foreground">You do not have permission to see payments.</p>;
  if (w.paymentRequest) {
    return <PaymentPanel applicationId={w.app.id} request={w.paymentRequest} payments={w.payments} canWrite={can(permissions, "finance.write")} compact />;
  }
  return (
    <p className="text-muted-foreground">
      {["offer_accepted", "payment_required", "payment_processing", "paid"].includes(w.app.status)
        ? "No payment request found; the offer may not have had fees payable on acceptance."
        : "Fees become due when the parent accepts the offer."}
    </p>
  );
}

export function RegistrationRecord({ w }: { w: ApplicantWorkspace }) {
  const state = w.registrationState;
  if (!state) return <p className="text-muted-foreground">Registration opens once the fees are paid.</p>;
  const waiting = w.documents.filter((d) => !d.superseded_by && d.review_status === "pending").length;
  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-1.5">
        {SECTIONS.map((s) => (
          <li key={s} className={`rounded-md border px-2 py-0.5 text-xs ${state.sections[s] ? "border-success/40 text-success" : "border-border text-muted-foreground"}`}>
            {SECTION_LABELS[s]}{state.sections[s] ? " ✓" : ""}
          </li>
        ))}
      </ul>
      {state.missingDocuments.length ? <p className="text-xs text-warning-foreground">Missing: {state.missingDocuments.map((d) => d.label).join(", ")}</p> : null}
      {state.rejectedDocuments.length ? <p className="text-xs text-destructive">To upload again: {state.rejectedDocuments.map((d) => d.label).join(", ")}</p> : null}
      {waiting ? <p className="text-xs">{waiting} document{waiting === 1 ? "" : "s"} waiting for review.</p> : null}
      <Link href={`/staff/registrations/${w.app.id}`} className="inline-block text-xs text-primary underline underline-offset-2">Open the registration</Link>
    </div>
  );
}

/** Every document the process has produced, as a PDF. Each download is audited by the route. */
export function DocumentsRecord({ w, permissions }: { w: ApplicantWorkspace; permissions: PermissionSet }) {
  const pdf = (kind: string) => `/staff/applications/${w.app.id}/pdf/${kind}`;
  const reportAttempt = w.attempts.find((at) => at.id === w.profile?.attempt_id) ?? w.latestAttempt;
  const succeeded = (w.payments ?? []).some((pm) => pm.status === "succeeded");
  const finance = can(permissions, "finance.read");
  const items: Array<{ label: string; href: string | null; why: string }> = [
    { label: "Offer letter", href: (w.offers ?? []).some((o) => o.status !== "draft") ? pdf("offer") : null, why: w.offers === null ? "No permission to see offers." : "No offer drafted yet." },
    { label: "Payment receipt", href: finance && succeeded ? pdf("receipt") : null, why: finance ? "No successful payment yet." : "Finance permission needed." },
    { label: "Learning profile", href: w.profile?.published_at ? pdf("profile") : null, why: w.app.requires_assessment ? "Not published yet." : "No assessment for this grade." },
    { label: "Assessment report", href: reportAttempt && w.profile ? `/staff/assessments/attempts/${reportAttempt.id}/report` : null, why: "Ready once the sitting is marked." },
    { label: "Registration record", href: w.registration ? pdf("registration") : null, why: "Registration has not started." },
    { label: "Signed agreements", href: w.acceptances.length ? pdf("agreements") : null, why: "No agreements signed yet." },
  ];
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-border rounded-lg border border-border">
        {items.map((it) => (
          <li key={it.label} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span className="font-medium">{it.label}</span>
            {it.href ? (
              <span className="flex gap-3 text-xs">
                <a href={it.href} target="_blank" rel="noopener" className="font-medium text-primary hover:underline">Open PDF</a>
                <a href={`${it.href}${it.href.includes("?") ? "&" : "?"}download=1`} className="font-medium text-primary hover:underline">Download</a>
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">{it.why}</span>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        The parent&rsquo;s uploaded documents are on the <Link href={`/staff/registrations/${w.app.id}`} className="text-primary underline underline-offset-2">registration page</Link>.
      </p>
    </div>
  );
}

export function WhatsAppRecord({ w, permissions }: { w: ApplicantWorkspace; permissions: PermissionSet }) {
  return (
    <MessagesPanel
      applicationId={w.app.id}
      messages={w.messages}
      events={w.messageEvents}
      // Addressable, and — for a child who does not sit one — not wording
      // that says "assessment": staff once sent exactly that to a pre-school
      // parent by hand, a second after the play-date confirmation.
      templates={w.messageTemplates
        .filter((t) => t.meta_template_name || t.twilio_content_sid || t.zavu_template_id)
        .filter((t) => w.app.requires_assessment || !saysAssessment(t.body_preview))}
      canSend={can(permissions, "applications.write")}
      action={sendWhatsAppTemplate}
    />
  );
}
