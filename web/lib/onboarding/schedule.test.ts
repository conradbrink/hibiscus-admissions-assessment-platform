import { describe, expect, it } from "vitest";
import { addDays, dueOn, JOURNEY, nextStep, stillWorthSending } from "@/lib/onboarding/schedule";

const START = "2027-01-12";

describe("the journey's shape", () => {
  it("is three before the first day and one after", () => {
    expect(JOURNEY.filter((j) => j.offsetDays < 0)).toHaveLength(3);
    expect(JOURNEY.filter((j) => j.offsetDays > 0)).toHaveLength(1);
  });

  it("ascends, which nextStep relies on to stop early", () => {
    const offsets = JOURNEY.map((j) => j.offsetDays);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
  });

  it("counts back from the first day", () => {
    expect(dueOn(START, "welcome")).toBe("2026-12-22");
    expect(dueOn(START, "outstanding")).toBe("2027-01-02");
    expect(dueOn(START, "first_day")).toBe("2027-01-09");
    expect(dueOn(START, "first_week")).toBe("2027-01-17");
  });
});

describe("nextStep", () => {
  it("sends nothing before the first offset", () => {
    expect(nextStep(START, "2026-12-21", [])).toBeNull();
  });

  it("sends the welcome on the day it falls due, and the day after", () => {
    expect(nextStep(START, "2026-12-22", [])).toBe("welcome");
    expect(nextStep(START, "2026-12-23", [])).toBe("welcome");
  });

  it("moves on once a step has been sent", () => {
    expect(nextStep(START, "2027-01-02", ["welcome"])).toBe("outstanding");
    expect(nextStep(START, "2027-01-09", ["welcome", "outstanding"])).toBe("first_day");
    expect(nextStep(START, "2027-01-17", ["welcome", "outstanding", "first_day"])).toBe("first_week");
  });

  it("waits when the next step is not due yet, even though earlier ones are done", () => {
    expect(nextStep(START, "2026-12-30", ["welcome"])).toBeNull();
  });

  it("says nothing when every step has been sent", () => {
    expect(nextStep(START, "2027-02-01", ["welcome", "outstanding", "first_day", "first_week"])).toBeNull();
  });

  it("never returns more than one step, however late the family enrolled", () => {
    // Enrolled eight days before term. Three offsets have already passed, and
    // firing all three today is the wall of messages the school asked to avoid.
    const late = "2027-01-04";
    expect(nextStep(START, late, [])).toBe("welcome");
    expect(nextStep(START, late, ["welcome"])).toBe("outstanding");
    expect(nextStep(START, late, ["welcome", "outstanding"])).toBeNull();
  });

  it("keeps the order even when a step is sent out of turn", () => {
    // Somebody sent the first-day details by hand. The welcome is still owed.
    expect(nextStep(START, "2027-01-09", ["first_day"])).toBe("welcome");
  });
});

describe("stillWorthSending", () => {
  it("will not welcome a child who has already started", () => {
    expect(stillWorthSending("welcome", START, "2027-01-11")).toBe(true);
    expect(stillWorthSending("welcome", START, START)).toBe(false);
    expect(stillWorthSending("welcome", START, "2027-01-13")).toBe(false);
  });

  it("will not chase a checklist for a child who has already started", () => {
    expect(stillWorthSending("outstanding", START, START)).toBe(false);
  });

  it("allows the first-day details on the morning itself, but not after", () => {
    expect(stillWorthSending("first_day", START, START)).toBe(true);
    expect(stillWorthSending("first_day", START, "2027-01-13")).toBe(false);
  });

  it("always allows the check-in, which is only ever due afterwards", () => {
    expect(stillWorthSending("first_week", START, "2027-03-01")).toBe(true);
  });
});

describe("addDays", () => {
  it("crosses a month, a year and a leap day", () => {
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
  });
});
