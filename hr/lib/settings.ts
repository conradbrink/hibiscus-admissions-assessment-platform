import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Json } from "@/lib/supabase/types";

/**
 * The HR settings, read from `hr_settings` with a default for every key so a
 * missing or malformed row degrades to the documented behaviour rather than
 * an exception on an applicant's page.
 */
export const ScoringWeightsSchema = z.object({
  qualifications: z.number().min(0).max(100),
  experience: z.number().min(0).max(100),
  answers: z.number().min(0).max(100),
  references: z.number().min(0).max(100),
  communication: z.number().min(0).max(100),
});

export type ScoringWeights = z.infer<typeof ScoringWeightsSchema>;

export const DEFAULT_WEIGHTS: ScoringWeights = {
  qualifications: 25,
  experience: 20,
  answers: 30,
  references: 15,
  communication: 10,
};

export type HrSettings = {
  referenceReminderDays: number[];
  referenceExpiryDays: number;
  draftExpiryDays: number;
  unsuccessfulRetentionMonths: number;
  talentPoolRetentionMonths: number;
  scoringWeights: ScoringWeights;
  aiMarkingEnabled: boolean;
  aiIntegrityEnabled: boolean;
  integrityNotice: string;
  privacyNoticeVersion: string;
  minReferees: number;
  maxReferees: number;
};

export const DEFAULT_HR_SETTINGS: HrSettings = {
  referenceReminderDays: [3, 7],
  referenceExpiryDays: 14,
  draftExpiryDays: 30,
  unsuccessfulRetentionMonths: 12,
  talentPoolRetentionMonths: 24,
  scoringWeights: DEFAULT_WEIGHTS,
  aiMarkingEnabled: true,
  aiIntegrityEnabled: true,
  integrityNotice:
    "Write every answer yourself. We check all answers for text written by AI tools such as ChatGPT. Answers that look AI-written are flagged, and you may be asked to explain them in your interview.",
  privacyNoticeVersion: "2026-10",
  minReferees: 2,
  maxReferees: 3,
};

function int(v: Json | undefined, fallback: number, min = 0, max = 10_000): number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

function bool(v: Json | undefined, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function text(v: Json | undefined, fallback: string): string {
  return typeof v === "string" && v.trim() ? v : fallback;
}

/** Pure: the settings from the rows. Unit tested. */
export function parseHrSettings(rows: ReadonlyArray<{ key: string; value: Json }>): HrSettings {
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const d = DEFAULT_HR_SETTINGS;
  const days = m.get("reference_reminder_days");
  const weights = ScoringWeightsSchema.safeParse(m.get("scoring_weights"));
  return {
    referenceReminderDays:
      Array.isArray(days) && days.every((n) => typeof n === "number" && n > 0 && n < 60)
        ? (days as number[]).slice().sort((a, b) => a - b)
        : d.referenceReminderDays,
    referenceExpiryDays: int(m.get("reference_expiry_days"), d.referenceExpiryDays, 1, 90),
    draftExpiryDays: int(m.get("draft_expiry_days"), d.draftExpiryDays, 1, 365),
    unsuccessfulRetentionMonths: int(m.get("unsuccessful_retention_months"), d.unsuccessfulRetentionMonths, 1, 120),
    talentPoolRetentionMonths: int(m.get("talent_pool_retention_months"), d.talentPoolRetentionMonths, 1, 120),
    scoringWeights: weights.success ? weights.data : d.scoringWeights,
    aiMarkingEnabled: bool(m.get("ai_marking_enabled"), d.aiMarkingEnabled),
    aiIntegrityEnabled: bool(m.get("ai_integrity_enabled"), d.aiIntegrityEnabled),
    integrityNotice: text(m.get("integrity_notice"), d.integrityNotice),
    privacyNoticeVersion: text(m.get("privacy_notice_version"), d.privacyNoticeVersion),
    minReferees: int(m.get("min_referees"), d.minReferees, 1, 5),
    maxReferees: int(m.get("max_referees"), d.maxReferees, 1, 5),
  };
}

export async function getHrSettings(client: SupabaseClient<Database>): Promise<HrSettings> {
  const { data, error } = await client.from("hr_settings").select("key, value");
  if (error) throw new Error(error.message);
  return parseHrSettings(data ?? []);
}
