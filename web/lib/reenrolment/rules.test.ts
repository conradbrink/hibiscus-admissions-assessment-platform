import { describe, expect, it } from "vitest";
import {
  addDays,
  detailsAreStale,
  isAnswered,
  isYearRollover,
  needsFollowUp,
  reminderDue,
  suggestNextGrade,
  summarise,
  type CycleLike,
  type ResponseLike,
} from "@/lib/reenrolment/rules";

const response = (o: Partial<ResponseLike> = {}): ResponseLike => ({
  intent: null,
  answered_at: null,
  reminders_sent: 0,
  last_reminder_at: null,
  details_confirmed_at: null,
  ...o,
});

const cycle: CycleLike = {
  opens_on: "2026-11-01",
  closes_on: "2026-11-30",
  reminder_offsets_days: [7, 2],
  ask_details_refresh: true,
};

describe("what counts as answered", () => {
  it("needs both a time and an intent", () => {
    expect(isAnswered(response())).toBe(false);
    expect(isAnswered(response({ answered_at: "2026-11-05T10:00:00Z" }))).toBe(false);
    expect(isAnswered(response({ intent: "returning" }))).toBe(false);
    expect(isAnswered(response({ intent: "returning", answered_at: "2026-11-05T10:00:00Z" }))).toBe(true);
  });

  it("treats undecided as an answer, but still a call to make", () => {
    const undecided = response({ intent: "undecided", answered_at: "2026-11-05T10:00:00Z" });
    expect(isAnswered(undecided)).toBe(true);
    expect(needsFollowUp(undecided)).toBe(true);
  });

  it("leaves a settled family alone", () => {
    expect(needsFollowUp(response({ intent: "returning", answered_at: "2026-11-05T10:00:00Z" }))).toBe(false);
    expect(needsFollowUp(response({ intent: "not_returning", answered_at: "2026-11-05T10:00:00Z" }))).toBe(false);
  });
});

describe("chasing", () => {
  it("sends the first reminder at the widest offset", () => {
    expect(reminderDue(response(), cycle, "2026-11-22")).toBe(false);
    expect(reminderDue(response(), cycle, "2026-11-23")).toBe(true);
  });

  it("does not fire every offset at once when a round opens late", () => {
    // Opened four days before it closes: the 7-day reminder is already past,
    // but only one goes out today, and the next waits for its own day.
    const late = response();
    expect(reminderDue(late, cycle, "2026-11-28")).toBe(true);
    const afterFirst = response({ reminders_sent: 1, last_reminder_at: "2026-11-28T09:00:00Z" });
    expect(reminderDue(afterFirst, cycle, "2026-11-28")).toBe(false);
    expect(reminderDue(afterFirst, cycle, "2026-11-29")).toBe(true);
  });

  it("stops once every offset is spent", () => {
    const spent = response({ reminders_sent: 2, last_reminder_at: "2026-11-29T09:00:00Z" });
    expect(reminderDue(spent, cycle, "2026-11-30")).toBe(false);
  });

  it("never chases a family who has answered", () => {
    const answered = response({ intent: "returning", answered_at: "2026-11-05T10:00:00Z" });
    expect(reminderDue(answered, cycle, "2026-11-29")).toBe(false);
  });

  it("stops after the round closes", () => {
    expect(reminderDue(response(), cycle, "2026-12-01")).toBe(false);
  });
});

describe("which class they come back to", () => {
  const grades = [
    { id: "prerec", sort_order: 10, is_active: true },
    { id: "rec", sort_order: 20, is_active: true },
    { id: "s1", sort_order: 30, is_active: true },
    { id: "s2-retired", sort_order: 35, is_active: false },
    { id: "s2", sort_order: 40, is_active: true },
  ];

  it("keeps the same class for a later term of the same year", () => {
    expect(suggestNextGrade(grades, "rec", false)).toBe("rec");
  });

  it("moves up one class for a new year", () => {
    expect(suggestNextGrade(grades, "rec", true)).toBe("s1");
  });

  it("skips a retired class rather than counting sort orders", () => {
    // The ladder has gaps, and the two Botswana ladders differ from the South
    // African one, so "the next active grade up" is the only safe rule.
    expect(suggestNextGrade(grades, "s1", true)).toBe("s2");
  });

  it("has no answer at the top of the school", () => {
    // A child leaving for secondary is a conversation, not a placement.
    expect(suggestNextGrade(grades, "s2", true)).toBeNull();
  });

  it("says nothing about a child with no class, or a class it does not know", () => {
    expect(suggestNextGrade(grades, null, true)).toBeNull();
    expect(suggestNextGrade(grades, "not-a-grade", true)).toBeNull();
  });
});

describe("year rollover", () => {
  it("is a later academic year than the one they are in", () => {
    expect(isYearRollover("2026-01-12", "2027-01-11")).toBe(true);
    expect(isYearRollover("2026-01-12", "2026-01-12")).toBe(false);
  });

  it("assumes no rollover when either year is unknown", () => {
    expect(isYearRollover(null, "2027-01-11")).toBe(false);
    expect(isYearRollover("2026-01-12", null)).toBe(false);
  });
});

describe("stale details", () => {
  it("counts never-confirmed as stale", () => {
    expect(detailsAreStale(null, "2026-11-01")).toBe(true);
  });

  it("goes stale after the window", () => {
    expect(detailsAreStale("2026-09-01T00:00:00Z", "2026-11-01")).toBe(false);
    expect(detailsAreStale("2025-11-01T00:00:00Z", "2026-11-01")).toBe(true);
  });
});

describe("the board", () => {
  it("counts only a yes as a place to plan around", () => {
    const s = summarise([
      response({ intent: "returning", answered_at: "x", details_confirmed_at: "x" }),
      response({ intent: "returning", answered_at: "x" }),
      response({ intent: "not_returning", answered_at: "x" }),
      response({ intent: "undecided", answered_at: "x" }),
      response(),
      response(),
    ]);
    expect(s).toEqual({
      total: 6,
      answered: 4,
      returning: 2,
      notReturning: 1,
      undecided: 1,
      unanswered: 2,
      detailsConfirmed: 1,
      // Not 3 and not 4: an undecided or a silence is not a place, and
      // counting it as one is how a term starts with classrooms that do not
      // add up.
      expected: 2,
    });
  });

  it("handles an empty round", () => {
    expect(summarise([]).total).toBe(0);
    expect(summarise([]).expected).toBe(0);
  });
});

describe("addDays", () => {
  it("crosses months and years", () => {
    expect(addDays("2026-11-30", -7)).toBe("2026-11-23");
    expect(addDays("2027-01-02", -5)).toBe("2026-12-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  });
});
