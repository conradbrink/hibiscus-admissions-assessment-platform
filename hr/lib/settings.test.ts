import { describe, expect, it } from "vitest";
import { DEFAULT_HR_SETTINGS, parseHrSettings } from "@/lib/settings";

describe("parseHrSettings", () => {
  it("falls back to every default when nothing is stored", () => {
    expect(parseHrSettings([])).toEqual(DEFAULT_HR_SETTINGS);
  });

  it("reads what is stored", () => {
    const s = parseHrSettings([
      { key: "reference_reminder_days", value: [7, 2] },
      { key: "ai_integrity_enabled", value: false },
      { key: "scoring_weights", value: { qualifications: 20, experience: 20, answers: 30, references: 20, communication: 10 } },
    ]);
    expect(s.referenceReminderDays).toEqual([2, 7]);
    expect(s.aiIntegrityEnabled).toBe(false);
    expect(s.scoringWeights.references).toBe(20);
  });

  it("ignores a malformed value rather than failing an applicant's page", () => {
    const s = parseHrSettings([
      { key: "reference_expiry_days", value: "fourteen" },
      { key: "scoring_weights", value: { qualifications: "a lot" } },
      { key: "reference_reminder_days", value: [0, -1] },
    ]);
    expect(s.referenceExpiryDays).toBe(14);
    expect(s.scoringWeights).toEqual(DEFAULT_HR_SETTINGS.scoringWeights);
    expect(s.referenceReminderDays).toEqual([3, 7]);
  });
});
