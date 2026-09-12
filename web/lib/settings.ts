import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";

/**
 * Workflow settings, typed, with defaults.
 *
 * The rows in `public.settings` are what an administrator edits. The defaults
 * here are what the engine uses if a row is missing or malformed, so a bad
 * edit degrades to sensible behaviour rather than to no reminders at all.
 *
 * The booleans are the "automate it later" switches: Phase 2 ships with a
 * person clicking Send on every post-decision email, and each switch removes
 * one click without a deploy.
 */
export type Settings = {
  bookingTokenDays: number;
  nextStepTokenDays: number;
  assessmentReminderHours: number[];
  enquiryNudgeHours: number;
  /** Days before the date a deferred family named, one entry per follow-up. Zero is the morning of the date. */
  deferralFollowUpDaysBefore: number[];
  offerExpiryDays: number;
  offerReminderDaysBefore: number[];
  parentSessionMinutes: number;
  /** Longer than the funnel's: the details-refresh form is a dozen questions on a phone. */
  familySessionMinutes: number;
  /** Send the re-enrolment ask and its reminders. Off until a round has been watched by hand. */
  reenrolmentAsksEnabled: boolean;
  onboardingJourneyEnabled: boolean;
  parentGuideUrl: string;
  kioskCodeMinutes: number;
  attemptGraceSeconds: number;
  autoSendOutcomes: boolean;
  offerAutoApprove: boolean;
  profileSharedOnDecline: boolean;
  aiNarrativeEnabled: boolean;
  paymentDueDays: number;
  paymentReminderDaysBefore: number[];
  paymentVerifyMinutes: number;
  registrationReminderDays: number[];
  /** Days after a submission with items outstanding before the parent is reminded. */
  documentsReminderDays: number;
  autoEnrol: boolean;
  whatsappEnabled: boolean;
  /** Require an authenticator app of every member of staff. Off: enrolling is each person's choice, and anybody who has enrolled is always asked. */
  staffMfaRequired: boolean;
  aiExtractionEnabled: boolean;
  aiSummaryEnabled: boolean;
  waitlistAutoPromote: boolean;
  retentionEnabled: boolean;
  retentionDaysAbandoned: number;
  retentionDaysClosed: number;
  digestEnabled: boolean;
  digestHour: number;
  rescheduleCutoffHours: number;
  rebookNudgeDays: number;
  autoSessionsEnabled: boolean;
  autoSessionsWeeksAhead: number;
  /** Clock readings, minutes after midnight in school time, sorted and distinct. */
  autoAssessmentStarts: number[];
  autoAssessmentDurationMinutes: number;
  autoVisitStarts: number[];
  autoVisitDurationMinutes: number;
  autoSessionCapacity: number;
  aiAutoMarkEnabled: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  bookingTokenDays: 14,
  nextStepTokenDays: 90,
  assessmentReminderHours: [48, 3],
  enquiryNudgeHours: 48,
  deferralFollowUpDaysBefore: [5, 0],
  offerExpiryDays: 14,
  offerReminderDaysBefore: [7, 2],
  parentSessionMinutes: 60,
  familySessionMinutes: 120,
  reenrolmentAsksEnabled: false,
  onboardingJourneyEnabled: false,
  parentGuideUrl: "",
  kioskCodeMinutes: 15,
  attemptGraceSeconds: 30,
  autoSendOutcomes: false,
  offerAutoApprove: false,
  profileSharedOnDecline: true,
  aiNarrativeEnabled: true,
  paymentDueDays: 14,
  paymentReminderDaysBefore: [7, 2],
  paymentVerifyMinutes: 10,
  registrationReminderDays: [7, 14],
  documentsReminderDays: 2,
  autoEnrol: false,
  whatsappEnabled: false,
  // Off on purpose. Thirty people sign in daily; switching a second factor on
  // for all of them at a distance is how a school loses a morning. See
  // supabase/migrations/20260913010000_staff_mfa.sql.
  staffMfaRequired: false,
  aiExtractionEnabled: false,
  aiSummaryEnabled: false,
  waitlistAutoPromote: false,
  retentionEnabled: false,
  retentionDaysAbandoned: 180,
  retentionDaysClosed: 365,
  digestEnabled: false,
  digestHour: 7,
  rescheduleCutoffHours: 24,
  rebookNudgeDays: 3,
  autoSessionsEnabled: true,
  autoSessionsWeeksAhead: 6,
  autoAssessmentStarts: [480, 570, 660],
  autoAssessmentDurationMinutes: 90,
  autoVisitStarts: [480, 570, 660],
  autoVisitDurationMinutes: 60,
  autoSessionCapacity: 6,
  aiAutoMarkEnabled: true,
};

const KEYS: Record<keyof Settings, string> = {
  bookingTokenDays: "booking_token_days",
  nextStepTokenDays: "next_step_token_days",
  assessmentReminderHours: "assessment_reminder_hours",
  enquiryNudgeHours: "enquiry_nudge_hours",
  deferralFollowUpDaysBefore: "deferral_follow_up_days_before",
  offerExpiryDays: "offer_expiry_days",
  offerReminderDaysBefore: "offer_reminder_days_before",
  parentSessionMinutes: "parent_session_minutes",
  familySessionMinutes: "family_session_minutes",
  reenrolmentAsksEnabled: "reenrolment_asks_enabled",
  onboardingJourneyEnabled: "onboarding_journey_enabled",
  parentGuideUrl: "parent_guide_url",
  kioskCodeMinutes: "kiosk_code_minutes",
  attemptGraceSeconds: "attempt_grace_seconds",
  autoSendOutcomes: "auto_send_outcomes",
  offerAutoApprove: "offer_auto_approve",
  profileSharedOnDecline: "profile_shared_on_decline",
  aiNarrativeEnabled: "ai_narrative_enabled",
  paymentDueDays: "payment_due_days",
  paymentReminderDaysBefore: "payment_reminder_days_before",
  paymentVerifyMinutes: "payment_verify_minutes",
  registrationReminderDays: "registration_reminder_days",
  documentsReminderDays: "documents_reminder_days",
  autoEnrol: "auto_enrol",
  whatsappEnabled: "whatsapp_enabled",
  staffMfaRequired: "staff_mfa_required",
  aiExtractionEnabled: "ai_extraction_enabled",
  aiSummaryEnabled: "ai_summary_enabled",
  waitlistAutoPromote: "waitlist_auto_promote",
  retentionEnabled: "retention_enabled",
  retentionDaysAbandoned: "retention_days_abandoned",
  retentionDaysClosed: "retention_days_closed",
  digestEnabled: "digest_enabled",
  digestHour: "digest_hour",
  rescheduleCutoffHours: "reschedule_cutoff_hours",
  rebookNudgeDays: "rebook_nudge_days",
  autoSessionsEnabled: "auto_sessions_enabled",
  autoSessionsWeeksAhead: "auto_sessions_weeks_ahead",
  autoAssessmentStarts: "auto_assessment_starts",
  autoAssessmentDurationMinutes: "auto_assessment_duration_minutes",
  autoVisitStarts: "auto_visit_starts",
  autoVisitDurationMinutes: "auto_visit_duration_minutes",
  autoSessionCapacity: "auto_session_capacity",
  aiAutoMarkEnabled: "ai_auto_mark_enabled",
};

function asPositiveInt(v: Json | undefined, fallback: number): number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : fallback;
}

/**
 * The same, but zero counts. "On the day" is a real offset, and the positive
 * version would drop it silently — leaving a school that asked for a reminder
 * on the date with no reminder on the date.
 *
 * An empty list is honoured rather than replaced: "do not follow up
 * automatically" is a thing a school may mean.
 */
function asNonNegativeIntArray(v: Json | undefined, fallback: number[]): number[] {
  if (!Array.isArray(v)) return fallback;
  return v.filter((x): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0);
}

function asPositiveIntArray(v: Json | undefined, fallback: number[]): number[] {
  if (!Array.isArray(v)) return fallback;
  const nums = v.filter((x): x is number => typeof x === "number" && Number.isInteger(x) && x > 0);
  return nums.length ? nums : fallback;
}

/**
 * A list of clock readings in minutes after midnight, sorted and distinct.
 *
 * Anything else is the fallback, whole. A partial list would be worse than
 * none: these times are typed into the raw settings editor, and half of a
 * mistyped list is a day that quietly gets fewer sittings than the school
 * thinks it has. Out of order or repeated is a mistake too — repeated means
 * two sittings at the same instant, which the unique index on `sessions`
 * refuses anyway, and the generator should not be the one to find out.
 */
function asMinutesList(v: Json | undefined, fallback: number[]): number[] {
  if (!Array.isArray(v) || v.length === 0) return fallback;
  const ok = v.every((x, i) =>
    typeof x === "number" && Number.isInteger(x) && x >= 0 && x < 1440 && (i === 0 || (typeof v[i - 1] === "number" && x > (v[i - 1] as number)))
  );
  return ok ? (v as number[]) : fallback;
}

function asHour(v: Json | undefined, fallback: number): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 23 ? v : fallback;
}

// A boolean setting that is anything other than true or false is the
// fallback — never "truthy", so a stray "yes" cannot switch automation on.
function asBoolean(v: Json | undefined, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/** Trimmed, because an empty setting and a setting of spaces mean the same thing. */
function asString(v: Json | undefined, fallback: string): string {
  return typeof v === "string" ? v.trim() : fallback;
}

export async function getSettings(supabase: SupabaseClient<Database>): Promise<Settings> {
  const { data, error } = await supabase.from("settings").select("key, value");
  if (error) throw new Error(error.message);
  const map = new Map<string, Json>((data ?? []).map((r) => [r.key, r.value]));
  const d = DEFAULT_SETTINGS;
  return {
    bookingTokenDays: asPositiveInt(map.get(KEYS.bookingTokenDays), d.bookingTokenDays),
    nextStepTokenDays: asPositiveInt(map.get(KEYS.nextStepTokenDays), d.nextStepTokenDays),
    assessmentReminderHours: asPositiveIntArray(
      map.get(KEYS.assessmentReminderHours),
      d.assessmentReminderHours
    ),
    enquiryNudgeHours: asPositiveInt(map.get(KEYS.enquiryNudgeHours), d.enquiryNudgeHours),
    deferralFollowUpDaysBefore: asNonNegativeIntArray(
      map.get(KEYS.deferralFollowUpDaysBefore),
      d.deferralFollowUpDaysBefore
    ),
    offerExpiryDays: asPositiveInt(map.get(KEYS.offerExpiryDays), d.offerExpiryDays),
    offerReminderDaysBefore: asPositiveIntArray(
      map.get(KEYS.offerReminderDaysBefore),
      d.offerReminderDaysBefore
    ),
    parentSessionMinutes: asPositiveInt(map.get(KEYS.parentSessionMinutes), d.parentSessionMinutes),
    familySessionMinutes: asPositiveInt(map.get(KEYS.familySessionMinutes), d.familySessionMinutes),
    reenrolmentAsksEnabled: asBoolean(map.get(KEYS.reenrolmentAsksEnabled), d.reenrolmentAsksEnabled),
    onboardingJourneyEnabled: asBoolean(map.get(KEYS.onboardingJourneyEnabled), d.onboardingJourneyEnabled),
    parentGuideUrl: asString(map.get(KEYS.parentGuideUrl), d.parentGuideUrl),
    kioskCodeMinutes: asPositiveInt(map.get(KEYS.kioskCodeMinutes), d.kioskCodeMinutes),
    attemptGraceSeconds: asPositiveInt(map.get(KEYS.attemptGraceSeconds), d.attemptGraceSeconds),
    autoSendOutcomes: asBoolean(map.get(KEYS.autoSendOutcomes), d.autoSendOutcomes),
    offerAutoApprove: asBoolean(map.get(KEYS.offerAutoApprove), d.offerAutoApprove),
    profileSharedOnDecline: asBoolean(map.get(KEYS.profileSharedOnDecline), d.profileSharedOnDecline),
    aiNarrativeEnabled: asBoolean(map.get(KEYS.aiNarrativeEnabled), d.aiNarrativeEnabled),
    paymentDueDays: asPositiveInt(map.get(KEYS.paymentDueDays), d.paymentDueDays),
    paymentReminderDaysBefore: asPositiveIntArray(map.get(KEYS.paymentReminderDaysBefore), d.paymentReminderDaysBefore),
    paymentVerifyMinutes: asPositiveInt(map.get(KEYS.paymentVerifyMinutes), d.paymentVerifyMinutes),
    registrationReminderDays: asPositiveIntArray(map.get(KEYS.registrationReminderDays), d.registrationReminderDays),
    documentsReminderDays: asPositiveInt(map.get(KEYS.documentsReminderDays), d.documentsReminderDays),
    autoEnrol: asBoolean(map.get(KEYS.autoEnrol), d.autoEnrol),
    whatsappEnabled: asBoolean(map.get(KEYS.whatsappEnabled), d.whatsappEnabled),
    staffMfaRequired: asBoolean(map.get(KEYS.staffMfaRequired), d.staffMfaRequired),
    aiExtractionEnabled: asBoolean(map.get(KEYS.aiExtractionEnabled), d.aiExtractionEnabled),
    aiSummaryEnabled: asBoolean(map.get(KEYS.aiSummaryEnabled), d.aiSummaryEnabled),
    waitlistAutoPromote: asBoolean(map.get(KEYS.waitlistAutoPromote), d.waitlistAutoPromote),
    retentionEnabled: asBoolean(map.get(KEYS.retentionEnabled), d.retentionEnabled),
    retentionDaysAbandoned: asPositiveInt(map.get(KEYS.retentionDaysAbandoned), d.retentionDaysAbandoned),
    retentionDaysClosed: asPositiveInt(map.get(KEYS.retentionDaysClosed), d.retentionDaysClosed),
    digestEnabled: asBoolean(map.get(KEYS.digestEnabled), d.digestEnabled),
    // The hour may legitimately be 0; a non-integer or out-of-range value falls back.
    digestHour: asHour(map.get(KEYS.digestHour), d.digestHour),
    rescheduleCutoffHours: asPositiveInt(map.get(KEYS.rescheduleCutoffHours), d.rescheduleCutoffHours),
    rebookNudgeDays: asPositiveInt(map.get(KEYS.rebookNudgeDays), d.rebookNudgeDays),
    autoSessionsEnabled: asBoolean(map.get(KEYS.autoSessionsEnabled), d.autoSessionsEnabled),
    autoSessionsWeeksAhead: asPositiveInt(map.get(KEYS.autoSessionsWeeksAhead), d.autoSessionsWeeksAhead),
    autoAssessmentStarts: asMinutesList(map.get(KEYS.autoAssessmentStarts), d.autoAssessmentStarts),
    autoAssessmentDurationMinutes: asPositiveInt(map.get(KEYS.autoAssessmentDurationMinutes), d.autoAssessmentDurationMinutes),
    autoVisitStarts: asMinutesList(map.get(KEYS.autoVisitStarts), d.autoVisitStarts),
    autoVisitDurationMinutes: asPositiveInt(map.get(KEYS.autoVisitDurationMinutes), d.autoVisitDurationMinutes),
    autoSessionCapacity: asPositiveInt(map.get(KEYS.autoSessionCapacity), d.autoSessionCapacity),
    aiAutoMarkEnabled: asBoolean(map.get(KEYS.aiAutoMarkEnabled), d.aiAutoMarkEnabled),
  };
}
