import { describe, expect, it } from "vitest";
import { TIMELINE_KIND_LABELS, groupByDay, mergeTimeline, takeTimeline, type TimelineEntry } from "@/lib/crm/timeline";

const e = (id: string, at: string, kind: TimelineEntry["kind"] = "note"): TimelineEntry => ({ id, kind, at, title: id });

describe("mergeTimeline", () => {
  it("merges sources newest first with a stable tiebreak", () => {
    const out = mergeTimeline([e("b", "2026-01-02T00:00:00Z"), e("a", "2026-01-02T00:00:00Z")], [e("c", "2026-01-03T00:00:00Z")], [e("d", "2026-01-01T00:00:00Z")]);
    expect(out.map((x) => x.id)).toEqual(["c", "a", "b", "d"]);
  });
  it("is empty when every source is", () => {
    expect(mergeTimeline([], [])).toEqual([]);
  });
});

describe("takeTimeline and groupByDay", () => {
  it("shows the first N and says how many more", () => {
    const all = mergeTimeline([e("a", "2026-01-03T00:00:00Z"), e("b", "2026-01-02T00:00:00Z"), e("c", "2026-01-01T00:00:00Z")]);
    expect(takeTimeline(all, 2)).toEqual({ shown: all.slice(0, 2), more: 1 });
    expect(takeTimeline(all, 5).more).toBe(0);
  });
  it("groups consecutive entries by day", () => {
    const all = mergeTimeline([e("a", "2026-01-03T10:00:00Z"), e("b", "2026-01-03T08:00:00Z"), e("c", "2026-01-01T00:00:00Z")]);
    const g = groupByDay(all, (iso) => iso.slice(0, 10));
    expect(g.map((x) => [x.day, x.entries.length])).toEqual([["2026-01-03", 2], ["2026-01-01", 1]]);
  });
  it("labels every kind", () => {
    for (const k of Object.keys(TIMELINE_KIND_LABELS)) expect(TIMELINE_KIND_LABELS[k as keyof typeof TIMELINE_KIND_LABELS]).toBeTruthy();
  });
});
