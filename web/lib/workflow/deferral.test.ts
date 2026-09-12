import { describe, expect, it } from "vitest";
import { deferralFollowUps, deferralTaskDueAt, isFutureDate } from "./deferral";

const at = (iso: string) => new Date(iso);

describe("deferralFollowUps", () => {
  it("queues five days before and the morning of, for a date a fortnight out", () => {
    const f = deferralFollowUps("2026-10-01", [5, 0], at("2026-09-12T10:00:00Z"));
    expect(f.map((x) => x.daysBefore)).toEqual([5, 0]);
    expect(f[0].runAt.toISOString()).toBe("2026-09-26T07:00:00.000Z");
    expect(f[1].runAt.toISOString()).toBe("2026-10-01T07:00:00.000Z");
  });

  it("drops an offset already in the past rather than firing it late", () => {
    // Deferred to three days out: "five days before" was two days ago, and
    // "we said we would call around now" arriving late is worse than silence.
    const f = deferralFollowUps("2026-09-15", [5, 0], at("2026-09-12T10:00:00Z"));
    expect(f.map((x) => x.daysBefore)).toEqual([0]);
  });

  it("queues nothing for a date that has already gone", () => {
    expect(deferralFollowUps("2026-09-01", [5, 0], at("2026-09-12T10:00:00Z"))).toEqual([]);
  });

  it("will not queue one that is about to fire, so a drain running twice sends once", () => {
    // 09:00+02:00 is 07:00Z; at 06:50Z the send is ten minutes away.
    expect(deferralFollowUps("2026-09-13", [0], at("2026-09-13T06:50:00Z"))).toEqual([]);
    expect(deferralFollowUps("2026-09-13", [0], at("2026-09-13T06:40:00Z"))).toHaveLength(1);
  });

  it("one entry is one message, and none is none", () => {
    expect(deferralFollowUps("2026-10-01", [3], at("2026-09-12T10:00:00Z"))).toHaveLength(1);
    expect(deferralFollowUps("2026-10-01", [], at("2026-09-12T10:00:00Z"))).toEqual([]);
  });

  it("tidies a hand-typed setting: repeats, negatives and the wrong order", () => {
    const f = deferralFollowUps("2026-10-01", [0, 5, 5, -2, 1.5], at("2026-09-12T10:00:00Z"));
    expect(f.map((x) => x.daysBefore)).toEqual([5, 0]);
  });

  it("carries the date in the suffix, so moving the date makes a fresh pair", () => {
    const a = deferralFollowUps("2026-10-01", [5], at("2026-09-12T10:00:00Z"))[0];
    const b = deferralFollowUps("2026-11-01", [5], at("2026-09-12T10:00:00Z"))[0];
    expect(a.suffix).toBe("2026-10-01:5d");
    expect(b.suffix).not.toBe(a.suffix);
  });
});

describe("the person behind the messages", () => {
  it("puts the call on the badge on the morning of the date", () => {
    expect(deferralTaskDueAt("2026-10-01").toISOString()).toBe("2026-10-01T07:00:00.000Z");
  });
});

describe("isFutureDate", () => {
  it("refuses a date in the past", () => {
    expect(isFutureDate("2026-09-01", at("2026-09-12T10:00:00Z"))).toBe(false);
    expect(isFutureDate("2026-09-13", at("2026-09-12T10:00:00Z"))).toBe(true);
  });
});
