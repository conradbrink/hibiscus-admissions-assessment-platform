import { describe, expect, it } from "vitest";
import { hintFirst, lateAttemptOf } from "./attempts";

type P = { status: "processing" | "expired" | "failed" | "succeeded"; method: "online" | "eft"; provider_ref: string | null; created_at: string };

const at = (hoursAgo: number, now: number) => new Date(now - hoursAgo * 3_600_000).toISOString();

describe("which attempt a parent can still ask about", () => {
  const now = Date.parse("2026-09-15T08:00:00Z");

  it("is the newest expired online attempt the gateway knows, within its checkout day", () => {
    const older: P = { status: "expired", method: "online", provider_ref: "ref-1", created_at: at(3, now) };
    const newer: P = { status: "expired", method: "online", provider_ref: "ref-2", created_at: at(1, now) };
    expect(lateAttemptOf([newer, older], now)).toBe(newer);
  });

  it("is not hidden by a newer failure the gateway never opened", () => {
    // The gateway refused to start a second checkout: no reference, nothing
    // to ask about. The first attempt may still have been paid.
    const paidLate: P = { status: "expired", method: "online", provider_ref: "ref-1", created_at: at(1, now) };
    const refused: P = { status: "failed", method: "online", provider_ref: null, created_at: at(0.5, now) };
    expect(lateAttemptOf([refused, paidLate], now)).toBe(paidLate);
  });

  it("is nothing once the gateway's own window has passed, or for a declined card, or a bank transfer", () => {
    const stale: P = { status: "expired", method: "online", provider_ref: "ref-1", created_at: at(30, now) };
    const declined: P = { status: "failed", method: "online", provider_ref: "ref-2", created_at: at(1, now) };
    const eft: P = { status: "expired", method: "eft", provider_ref: null, created_at: at(1, now) };
    expect(lateAttemptOf([stale, declined, eft], now)).toBeNull();
  });
});

describe("the gateway's hint only orders, never decides", () => {
  it("puts the hinted attempt first and keeps the rest", () => {
    const a = { provider_ref: "a" };
    const b = { provider_ref: "b" };
    expect(hintFirst([a, b], "b")).toEqual([b, a]);
    expect(hintFirst([a, b], null)).toEqual([a, b]);
    expect(hintFirst([a, b], "zzz")).toEqual([a, b]);
  });
});
