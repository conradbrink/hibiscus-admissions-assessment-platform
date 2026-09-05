import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";

/**
 * Workflow settings, typed, with defaults.
 *
 * The rows in `public.settings` are what an administrator edits. The defaults
 * here are what the engine uses if a row is missing or malformed, so a bad
 * edit degrades to sensible behaviour rather than to no reminders at all.
 */
export type Settings = {
  bookingTokenDays: number;
  nextStepTokenDays: number;
  assessmentReminderHours: number[];
  enquiryNudgeHours: number;
  offerExpiryDays: number;
  offerReminderDaysBefore: number[];
  parentSessionMinutes: number;
};

export const DEFAULT_SETTINGS: Settings = {
  bookingTokenDays: 14,
  nextStepTokenDays: 90,
  assessmentReminderHours: [48, 3],
  enquiryNudgeHours: 48,
  offerExpiryDays: 14,
  offerReminderDaysBefore: [7, 2],
  parentSessionMinutes: 60,
};

const KEYS: Record<keyof Settings, string> = {
  bookingTokenDays: "booking_token_days",
  nextStepTokenDays: "next_step_token_days",
  assessmentReminderHours: "assessment_reminder_hours",
  enquiryNudgeHours: "enquiry_nudge_hours",
  offerExpiryDays: "offer_expiry_days",
  offerReminderDaysBefore: "offer_reminder_days_before",
  parentSessionMinutes: "parent_session_minutes",
};

function asPositiveInt(v: Json | undefined, fallback: number): number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : fallback;
}

function asPositiveIntArray(v: Json | undefined, fallback: number[]): number[] {
  if (!Array.isArray(v)) return fallback;
  const nums = v.filter((x): x is number => typeof x === "number" && Number.isInteger(x) && x > 0);
  return nums.length ? nums : fallback;
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
  };
}
