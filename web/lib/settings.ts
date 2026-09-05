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
  offerExpiryDays: number;
  offerReminderDaysBefore: number[];
  parentSessionMinutes: number;
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
  autoEnrol: boolean;
  whatsappEnabled: boolean;
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
};

export const DEFAULT_SETTINGS: Settings = {
  bookingTokenDays: 14,
  nextStepTokenDays: 90,
  assessmentReminderHours: [48, 3],
  enquiryNudgeHours: 48,
  offerExpiryDays: 14,
  offerReminderDaysBefore: [7, 2],
  parentSessionMinutes: 60,
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
  autoEnrol: false,
  whatsappEnabled: false,
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
};

const KEYS: Record<keyof Settings, string> = {
  bookingTokenDays: "booking_token_days",
  nextStepTokenDays: "next_step_token_days",
  assessmentReminderHours: "assessment_reminder_hours",
  enquiryNudgeHours: "enquiry_nudge_hours",
  offerExpiryDays: "offer_expiry_days",
  offerReminderDaysBefore: "offer_reminder_days_before",
  parentSessionMinutes: "parent_session_minutes",
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
  autoEnrol: "auto_enrol",
  whatsappEnabled: "whatsapp_enabled",
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
};

function asPositiveInt(v: Json | undefined, fallback: number): number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : fallback;
}

function asPositiveIntArray(v: Json | undefined, fallback: number[]): number[] {
  if (!Array.isArray(v)) return fallback;
  const nums = v.filter((x): x is number => typeof x === "number" && Number.isInteger(x) && x > 0);
  return nums.length ? nums : fallback;
}

function asHour(v: Json | undefined, fallback: number): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 23 ? v : fallback;
}

// A boolean setting that is anything other than true or false is the
// fallback — never "truthy", so a stray "yes" cannot switch automation on.
function asBoolean(v: Json | undefined, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
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
    offerExpiryDays: asPositiveInt(map.get(KEYS.offerExpiryDays), d.offerExpiryDays),
    offerReminderDaysBefore: asPositiveIntArray(
      map.get(KEYS.offerReminderDaysBefore),
      d.offerReminderDaysBefore
    ),
    parentSessionMinutes: asPositiveInt(map.get(KEYS.parentSessionMinutes), d.parentSessionMinutes),
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
    autoEnrol: asBoolean(map.get(KEYS.autoEnrol), d.autoEnrol),
    whatsappEnabled: asBoolean(map.get(KEYS.whatsappEnabled), d.whatsappEnabled),
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
  };
}
