import { describe, expect, it } from "vitest";
import { drainHealth } from "@/lib/workflow/drain-health";

const now = new Date("2026-09-10T12:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe("drainHealth", () => {
  it("is content while the drain is keeping to its five minutes", () => {
    expect(drainHealth(minutesAgo(0), now).tone).toBe("success");
    expect(drainHealth(minutesAgo(5), now).tone).toBe("success");
    expect(drainHealth(minutesAgo(14), now).tone).toBe("success");
  });

  it("warns once a run has been missed, and escalates past the hourly backstop", () => {
    expect(drainHealth(minutesAgo(15), now).tone).toBe("warning");
    expect(drainHealth(minutesAgo(59), now).tone).toBe("warning");
    expect(drainHealth(minutesAgo(60), now).tone).toBe("destructive");
    expect(drainHealth(minutesAgo(4 * 60), now).tone).toBe("destructive");
  });

  it("treats never having run as the worst case, not the best", () => {
    // The bug this is here to catch reads as an empty table, and an empty
    // table must not look like a healthy one.
    const h = drainHealth(null, now);
    expect(h.tone).toBe("destructive");
    expect(h.phrase).toContain("never run");
  });

  it("reads a run stamped in the future as just now", () => {
    // Two clocks disagreeing is not a queue problem, and "in -3 minutes" is
    // not a sentence.
    const h = drainHealth(new Date(now.getTime() + 3 * 60_000), now);
    expect(h.tone).toBe("success");
    expect(h.phrase).toBe("The scheduled drain last ran less than a minute ago.");
  });

  it("says how long ago in units a person reads", () => {
    expect(drainHealth(minutesAgo(1), now).phrase).toContain("1 minute ago");
    expect(drainHealth(minutesAgo(42), now).phrase).toContain("42 minutes ago");
    expect(drainHealth(minutesAgo(60), now).phrase).toContain("1 hour ago");
    expect(drainHealth(minutesAgo(200), now).phrase).toContain("3 hours ago");
    expect(drainHealth(minutesAgo(60 * 24), now).phrase).toContain("1 day ago");
    expect(drainHealth(minutesAgo(60 * 24 * 3), now).phrase).toContain("3 days ago");
  });

  it("accepts the timestamp string the database hands back", () => {
    expect(drainHealth("2026-09-10T11:58:00Z", now).tone).toBe("success");
  });
});
