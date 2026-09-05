import { describe, expect, it } from "vitest";
import { ABANDONED_STATUSES, CLOSED_STATUSES, digestHasContent, digestKey, gaboroneNow, groupByPlace, retentionCandidates, waitlistOrder } from "@/lib/workflow/automation/rules";

const now = new Date("2026-09-05T08:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

describe("retentionCandidates", () => {
  const settings = { retentionDaysAbandoned: 180, retentionDaysClosed: 365 };
  it("picks abandoned enquiries after the shorter period and closed applications after the longer", () => {
    const rows = [
      { id: "a", status: "new_enquiry" as const, status_changed_at: daysAgo(181), retention_hold: false, anonymised_at: null },
      { id: "b", status: "new_enquiry" as const, status_changed_at: daysAgo(179), retention_hold: false, anonymised_at: null },
      { id: "c", status: "declined" as const, status_changed_at: daysAgo(366), retention_hold: false, anonymised_at: null },
      { id: "d", status: "declined" as const, status_changed_at: daysAgo(200), retention_hold: false, anonymised_at: null },
      { id: "e", status: "enrolled" as const, status_changed_at: daysAgo(900), retention_hold: false, anonymised_at: null },
    ];
    expect(retentionCandidates(rows, settings, now).map((r) => r.id)).toEqual(["a", "c"]);
  });
  it("never picks a held or already anonymised application", () => {
    const rows = [
      { id: "held", status: "withdrawn" as const, status_changed_at: daysAgo(400), retention_hold: true, anonymised_at: null },
      { id: "done", status: "withdrawn" as const, status_changed_at: daysAgo(400), retention_hold: false, anonymised_at: daysAgo(1) },
    ];
    expect(retentionCandidates(rows, settings, now)).toEqual([]);
  });
  it("names the statuses it covers and no in-flight one", () => {
    expect(ABANDONED_STATUSES).toEqual(["new_enquiry", "callback_requested", "no_show"]);
    expect(CLOSED_STATUSES).toEqual(["declined", "withdrawn", "offer_declined", "offer_expired"]);
    expect([...ABANDONED_STATUSES, ...CLOSED_STATUSES]).not.toContain("offer_sent");
  });
});

describe("waitlist", () => {
  it("orders by how long they have waited and groups by the place they compete for", () => {
    const rows = [
      { id: "later", campus_id: "c1", grade_id: "g1", intake_id: "i2", status_changed_at: daysAgo(2) },
      { id: "first", campus_id: "c1", grade_id: "g1", intake_id: "i1", status_changed_at: daysAgo(10) },
      { id: "other", campus_id: "c2", grade_id: "g1", intake_id: "i1", status_changed_at: daysAgo(5) },
    ];
    expect(waitlistOrder(rows).map((r) => r.id)).toEqual(["first", "other", "later"]);
    // Two intakes of the same academic year compete for the same places.
    const groups = groupByPlace(rows, (i) => (i === "i1" || i === "i2" ? "y1" : null));
    expect([...groups.keys()]).toEqual(["c1:g1:y1", "c2:g1:y1"]);
    expect(groups.get("c1:g1:y1")?.map((r) => r.id)).toEqual(["later", "first"]);
  });
});

describe("digest", () => {
  it("keys one job per campus per Gaborone day", () => {
    expect(digestKey("c1", "2026-09-05")).toBe("digest:c1:2026-09-05");
    // 23:30 UTC is 01:30 the next day in Gaborone (UTC+2).
    expect(gaboroneNow(new Date("2026-09-05T23:30:00Z"))).toEqual({ date: "2026-09-06", hour: 1 });
    expect(gaboroneNow(new Date("2026-09-05T05:10:00Z"))).toEqual({ date: "2026-09-05", hour: 7 });
  });
  it("is not sent when there is nothing to say", () => {
    expect(digestHasContent({ a: 0, b: 0 })).toBe(false);
    expect(digestHasContent({ a: 0, b: 2 })).toBe(true);
  });
});
