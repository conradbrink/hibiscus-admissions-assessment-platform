import { describe, expect, it } from "vitest";
import { formatTrialWeek, nextMonday, trialWeekDates, trialWeekEnd } from "@/lib/workflow/trial-week-dates";

describe("trial week dates", () => {
  it("suggests the next Monday, never today", () => {
    expect(nextMonday(new Date("2026-09-20T10:00:00Z"))).toBe("2026-09-21"); // Sunday
    expect(nextMonday(new Date("2026-09-21T10:00:00Z"))).toBe("2026-09-28"); // Monday
    expect(nextMonday(new Date("2026-09-23T23:30:00Z"))).toBe("2026-09-28"); // Wednesday
    expect(nextMonday(new Date("2026-09-26T00:00:00Z"))).toBe("2026-09-28"); // Saturday
  });

  it("ends a week on the Friday", () => {
    expect(trialWeekEnd("2026-10-12")).toBe("2026-10-16");
    expect(trialWeekEnd("2026-12-28")).toBe("2027-01-01");
    expect(trialWeekEnd("not a date")).toBeNull();
  });

  it("checks what the form gave", () => {
    const today = new Date("2026-09-20T08:00:00Z");
    expect(trialWeekDates("2026-10-12", null, today)).toEqual({ ok: true, dates: { startsOn: "2026-10-12", endsOn: "2026-10-16" } });
    expect(trialWeekDates("2026-10-12", "2026-10-14", today)).toEqual({ ok: true, dates: { startsOn: "2026-10-12", endsOn: "2026-10-14" } });
    // The week running now is still on: today falls inside it.
    expect(trialWeekDates("2026-09-14", "2026-09-25", today).ok).toBe(true);
    expect(trialWeekDates("", null, today)).toMatchObject({ ok: false, error: expect.stringMatching(/Choose the Monday/) });
    expect(trialWeekDates("2026-02-30", null, today)).toMatchObject({ ok: false });
    expect(trialWeekDates("2026-10-12", "2026-10-09", today)).toMatchObject({ ok: false, error: expect.stringMatching(/cannot end before/) });
    expect(trialWeekDates("2026-10-12", "2026-11-12", today)).toMatchObject({ ok: false, error: expect.stringMatching(/two at most/) });
    expect(trialWeekDates("2026-09-07", null, today)).toMatchObject({ ok: false, error: expect.stringMatching(/already passed/) });
  });

  it("writes the week out the way a parent reads it", () => {
    expect(formatTrialWeek({ startsOn: "2026-10-12", endsOn: "2026-10-16" })).toBe("Mon 12 to Fri 16 October 2026");
    expect(formatTrialWeek({ startsOn: "2026-09-28", endsOn: "2026-10-02" })).toBe("Mon 28 September to Fri 2 October 2026");
    expect(formatTrialWeek({ startsOn: "2026-10-12", endsOn: "2026-10-12" })).toBe("Mon 12 October 2026");
  });
});
