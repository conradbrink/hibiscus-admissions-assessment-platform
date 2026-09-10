import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";
import { DEFAULT_SETTINGS, getSettings } from "@/lib/settings";

/** The one call `getSettings` makes, answered from a literal. */
function stub(rows: Array<{ key: string; value: Json }>) {
  return {
    from: () => ({ select: async () => ({ data: rows, error: null }) }),
  } as unknown as SupabaseClient<Database>;
}

const starts = (value: Json) => getSettings(stub([{ key: "auto_assessment_starts", value }]));

describe("the schedule's sitting times", () => {
  it("are read as a list of clock readings", async () => {
    const s = await starts([480, 570, 660]);
    expect(s.autoAssessmentStarts).toEqual([480, 570, 660]);
  });

  it("default to 08:00, 09:30 and 11:00 when the row is missing", async () => {
    const s = await getSettings(stub([]));
    expect(s.autoAssessmentStarts).toEqual([480, 570, 660]);
    expect(s.autoVisitStarts).toEqual([480, 570, 660]);
  });

  it("fall back whole rather than in part", async () => {
    // Half of a mistyped list is worse than none of it: the school would get
    // fewer sittings a day than the settings page appears to say, and nothing
    // would report it. Each of these is rejected entire.
    for (const bad of [
      [660, 480], // out of order
      [480, 480], // the same instant twice, which the unique index refuses anyway
      [480, 1440], // 24:00
      [-60, 480],
      [480, 570.5],
      [480, "570"],
      [],
      540, // the old singular shape
      null,
      "480,570",
    ] as Json[]) {
      const s = await starts(bad);
      expect(s.autoAssessmentStarts, JSON.stringify(bad)).toEqual(DEFAULT_SETTINGS.autoAssessmentStarts);
    }
  });

  it("accept a single time, and midnight", async () => {
    expect((await starts([540])).autoAssessmentStarts).toEqual([540]);
    expect((await starts([0, 1439])).autoAssessmentStarts).toEqual([0, 1439]);
  });
});
