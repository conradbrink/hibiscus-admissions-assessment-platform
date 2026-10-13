import Link from "next/link";
import { ActionForm } from "@/components/staff/action-form";
import { MessagesPanel } from "@/components/staff/messages-panel";
import { OfferConditionsFields } from "@/components/staff/offer-conditions-fields";
import { PaymentPanel } from "@/components/staff/payment-panel";
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
import { SECTION_LABELS, SECTIONS } from "@/lib/registration/completeness";
import type { RuleResult } from "@/lib/rules/evaluate";
import { formatMonth, type MonthChoice } from "@/lib/start-month";
import type { BenchmarkBand } from "@/lib/supabase/types";
import { APPOINTMENT_LABELS, APPOINTMENT_STATE, APPOINTMENT_STEPS } from "@/lib/workflow/appointment";
import { cn } from "@/lib/utils";
import { approveOffer, generateOffer, withdrawOffer } from "@/app/staff/(console)/offers/actions";
import { sendWhatsAppTemplate, setDayPattern, setScholarship, setStartMonth } from "@/app/staff/(console)/applications/[id]/actions";
import type { ApplicantWorkspace } from "@/app/staff/(console)/applications/[id]/load";

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
  if (!w.decisions.length) return <p className="text-muted-foreground">No decision yet.</p>;
  return (
    <ol className="space-y-2">
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
  );
}

// ---------------------------------------------------------------------------
// Offer
// ---------------------------------------------------------------------------

export type OfferSettings = {
  dayPattern: { value: "half" | "full" | null; canSet: boolean; unit: "term" | "month" } | null;
  startMonth: { value: string | null; canSet: boolean; choices: MonthChoice[] } | null;
  scholarshipBand: { code: string | null; promotionId: string | null; isScholarship: boolean; canSet: boolean; choices: string[] } | null;
};

/** The letter and the three things that decide what it says: the starting month, the day pattern and the scholarship. */
export function OfferRecord({ w, permissions, settings }: { w: ApplicantWorkspace; permissions: PermissionSet; settings: OfferSettings }) {
  const { dayPattern, startMonth, scholarshipBand } = settings;
  const canApprove = can(permissions, "offers.approve");
  const liveOffer = w.liveOffer;
  const offers = w.offers;
  // The most recent letter of any status: a withdrawn one is not live, and
  // withdrawing is exactly what staff are told to do before re-pricing.
  const newestOffer = (offers ?? [])[0] ?? null;
  const bandMovedSinceOffer = Boolean(newestOffer && scholarshipBand && newestOffer.promotion_id !== scholarshipBand.promotionId);
  const offerPricedUnder = awardLabelOf((feeSnapshotFrom(newestOffer?.fees) as PromotionFeeSnapshot | null)?.promotion?.code ?? null);
  const idField = <input type="hidden" name="applicationId" value={w.app.id} />;

  return (
    <div className="space-y-4">
      {startMonth || dayPattern || scholarshipBand ? (
        <div className="grid gap-3 md:grid-cols-3">
          {startMonth ? (
            <div className="rounded-lg border border-border p-3">
              <h3 className="text-xs font-semibold text-muted-foreground">Starting month</h3>
              <p className="mt-0.5 font-medium">{startMonth.value ? formatMonth(startMonth.value) : "Not chosen — the letter names the term"}</p>
              {startMonth.canSet ? (
                <ActionForm action={setStartMonth} label="Save" variant="outline" size="xs" className="mt-2">
                  {idField}
                  <NativeSelect name="startMonth" defaultValue={startMonth.value ?? ""} aria-label="Starting month">
                    <option value="">Not chosen yet</option>
                    {startMonth.value && !startMonth.choices.some((c) => c.value === startMonth.value) ? (
                      <option value={startMonth.value}>{formatMonth(startMonth.value)}</option>
                    ) : null}
                    {startMonth.choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </NativeSelect>
                  <p className="text-xs text-muted-foreground">What the next letter names and the first-day emails count from. A letter already sent keeps its month.</p>
                </ActionForm>
              ) : null}
            </div>
          ) : null}
          {dayPattern ? (
            <div className="rounded-lg border border-border p-3">
              <h3 className="text-xs font-semibold text-muted-foreground">Full or half day</h3>
              <p className="mt-0.5 font-medium">{dayPattern.value === "half" ? "Half day" : dayPattern.value === "full" ? "Full day" : "Not decided yet"}</p>
              {dayPattern.canSet ? (
                <ActionForm action={setDayPattern} label="Save" variant="outline" size="xs" className="mt-2">
                  {idField}
                  <NativeSelect name="dayPattern" defaultValue={dayPattern.value ?? ""} aria-label="Full or half day">
                    <option value="">Not decided yet</option>
                    <option value="half">Half day</option>
                    <option value="full">Full day</option>
                  </NativeSelect>
                  <p className="text-xs text-muted-foreground">
                    Decides which {dayPattern.unit === "month" ? "monthly" : "term"} fee the next letter quotes; undecided, it shows both. A letter already sent keeps its fees.
                  </p>
                </ActionForm>
              ) : null}
            </div>
          ) : null}
          {scholarshipBand ? (
            <div className="rounded-lg border border-border p-3">
              <h3 className="text-xs font-semibold text-muted-foreground">Scholarship</h3>
              <p className="mt-0.5 font-medium">
                {scholarshipBand.isScholarship
                  ? `${awardLabelOf(scholarshipBand.code)} of tuition`
                  : scholarshipBand.code
                    ? `None. Holds the ${scholarshipBand.code} deal.`
                    : "None"}
              </p>
              {bandMovedSinceOffer ? (
                <p className="mt-2 rounded-lg bg-warning/15 px-2 py-1.5 text-xs text-warning-foreground">
                  {offerPricedUnder ? `The most recent letter was priced at ${offerPricedUnder}, not this. ` : "The most recent letter was priced under a different deal. "}
                  {liveOffer ? "Create the offer again to re-price it." : "Nothing is drafted now — create an offer to issue one at this band."}
                </p>
              ) : null}
              {scholarshipBand.canSet ? (
                <ActionForm action={setScholarship} label="Save" variant="outline" size="xs" className="mt-2">
                  {idField}
                  <NativeSelect
                    name="code"
                    defaultValue={scholarshipBand.isScholarship ? (scholarshipBand.code ?? "") : scholarshipBand.code ? "keep" : ""}
                    aria-label="Scholarship band"
                  >
                    {/* A child on an ordinary deal starts on "keep", so saving
                        without choosing cannot take the deal off them. */}
                    {scholarshipBand.code && !scholarshipBand.isScholarship ? <option value="keep">Keep the {scholarshipBand.code} deal</option> : null}
                    <option value="">{scholarshipBand.code && !scholarshipBand.isScholarship ? `Remove the ${scholarshipBand.code} deal` : "No scholarship"}</option>
                    {scholarshipBand.choices.map((c) => <option key={c} value={c}>{awardLabelOf(c)}</option>)}
                  </NativeSelect>
                  <Input name="reason" placeholder="Why (optional)" maxLength={500} aria-label="Why the band changed" />
                  <p className="text-xs text-muted-foreground">
                    {liveOffer && liveOffer.status !== "draft"
                      ? "A letter already with the family keeps its fees. To change them, withdraw it and issue a fresh one."
                      : newestOffer
                        ? "Changing the band does not rewrite a letter. Create the offer again to re-price it."
                        : "Decides the tuition the next letter quotes."}
                    {scholarshipBand.code && !scholarshipBand.isScholarship ? " Awarding a scholarship replaces the deal; there is only ever one." : ""}
                  </p>
                </ActionForm>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {offers === null ? (
        <p className="text-muted-foreground">You do not have permission to see offers.</p>
      ) : liveOffer ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={liveOffer.status === "viewed" || liveOffer.status === "sent" ? "info" : liveOffer.status === "expired" ? "warning" : "secondary"}>
              {liveOffer.status.replace("_", " ")}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Drafted {formatDateTime(liveOffer.created_at)}
              {liveOffer.sent_at ? ` · sent ${formatDateTime(liveOffer.sent_at)}` : ""}
              {liveOffer.first_viewed_at ? ` · opened ${formatDateTime(liveOffer.first_viewed_at)}` : ""}
              {liveOffer.expires_at ? ` · open until ${formatDate(liveOffer.expires_at)}` : ""}
            </span>
          </div>
          {(() => {
            const f = feeSnapshotFrom(liveOffer.fees);
            return f ? (
              <ul className="rounded-lg border border-border p-2 text-xs">
                {feeLinesFor(f, dayPattern?.value ?? null).map((l) => (
                  <li key={l.code} className="flex justify-between"><span>{l.label}</span><span className="tabular-nums">{formatMoney(l.amount_minor, f.currency)}</span></li>
                ))}
                <li className="mt-1 flex justify-between border-t border-border pt-1 font-semibold">
                  <span>Payable on acceptance</span><span className="tabular-nums">{formatMoney(f.payable_at_acceptance_minor, f.currency)}</span>
                </li>
              </ul>
            ) : (
              <p className="text-warning-foreground">
                No fee schedule covers this campus, grade and year, so the offer cannot be sent.{" "}
                <Link href="/staff/admin/fees" className="text-primary underline underline-offset-2">Configure fees</Link>, then create the offer again.
              </p>
            );
          })()}
          {liveOffer.conditions ? <p className="text-xs"><span className="font-medium">Conditions:</span> {liveOffer.conditions}</p> : null}
          {canApprove && (liveOffer.status === "draft" || liveOffer.status === "pending_approval") ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-primary">{liveOffer.conditions ? "Change the conditions" : "Add conditions"}</summary>
              <ActionForm action={generateOffer} label="Apply conditions and re-draft" size="sm" variant="outline" className="mt-2 space-y-3" confirm="Re-draft this offer with these conditions? It still waits for approval.">
                {idField}
                <OfferConditionsFields grades={w.grades} currentGradeSort={w.grade?.sort_order ?? 0} compact />
              </ActionForm>
            </details>
          ) : null}
          <details>
            <summary className="cursor-pointer text-primary">Preview as the parent reads it</summary>
            <div className="prose prose-sm mt-2 max-w-none rounded-lg border border-border bg-background p-4" dangerouslySetInnerHTML={{ __html: liveOffer.rendered_html + liveOffer.terms_html }} />
          </details>
          {canApprove && liveOffer.status !== "expired" ? (
            // Withdrawing is a correction, not the next step: it sits here,
            // quietly, rather than beside Approve.
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">Withdraw this offer to correct it</summary>
              <ActionForm action={withdrawOffer} label="Withdraw & re-draft" size="sm" variant="outline" className="mt-2 flex flex-wrap items-center gap-2 space-y-0" confirm="Withdraw this offer? The parent's link stops working and a corrected one can be issued.">
                {idField}<input type="hidden" name="offerId" value={liveOffer.id} />
                <Input name="reason" placeholder="Why" className="h-8 w-56" required minLength={3} />
              </ActionForm>
            </details>
          ) : null}
        </div>
      ) : (
        <p className="text-muted-foreground">
          {offers.length ? `${offers.length} earlier offer${offers.length === 1 ? "" : "s"} withdrawn. ` : ""}
          {w.app.status === "waitlisted" || w.app.status === "declined" ? "No offer for this outcome." : "No offer yet; one is drafted when the applicant is accepted."}
        </p>
      )}
      {offers && offers.length > 1 ? (
        <ul className="text-xs text-muted-foreground">
          {offers.filter((o) => o.id !== liveOffer?.id).map((o) => (
            <li key={o.id}>{o.status} · drafted {formatDate(o.created_at)}{o.withdrawn_reason ? ` · ${o.withdrawn_reason}` : ""}</li>
          ))}
        </ul>
      ) : null}
      {canApprove ? <Link href="/staff/offers" className="inline-block text-xs text-primary underline underline-offset-2">All offers</Link> : null}
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
