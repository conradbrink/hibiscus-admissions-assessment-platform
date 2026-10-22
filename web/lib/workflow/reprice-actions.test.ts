import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminClient } from "@/lib/supabase/admin";
import { SYSTEM_ACTOR } from "@/lib/workflow/engine";

/**
 * Saving the starting month when the letter is already written: it re-prices
 * the letter, and saving the same month again finishes a re-price that
 * failed after the month was saved (the code review of 22 October 2026 found
 * that the second press used to do nothing at all).
 *
 * The drafting itself is `onOfferDrafted`'s and has its own tests; here it is
 * a mock, so what is checked is the decision: when to re-draft, and that a
 * month already saved is not saved twice.
 */

const drafted = vi.fn(async () => ({ offerId: "offer-2", blocked: false }));
const withdrawn = vi.fn(async () => undefined);
vi.mock("@/lib/workflow/offer-actions", () => ({ onOfferDrafted: drafted, onOfferWithdrawn: withdrawn }));
vi.mock("@/lib/offers/render", () => ({ resolveFeeSchedule: async () => ({ schedule: {}, lines: [{ code: "registration" }] }) }));

const { onStartMonthChanged } = await import("@/lib/workflow/reprice-actions");

/** A Supabase double that applies `.eq` filters to the rows given per table and logs writes and commits. */
function stub(rows: Record<string, Array<Record<string, unknown>>>) {
  const log: string[] = [];
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const result = (one: boolean) => {
      const hits = (rows[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
      return { data: one ? (hits[0] ?? null) : hits, error: null };
    };
    const q: Record<string, unknown> = {};
    for (const m of ["select", "in", "order", "limit", "not", "is", "or"]) q[m] = () => q;
    q.eq = (k: string, v: unknown) => {
      filters.push([k, v]);
      return q;
    };
    q.update = () => {
      log.push(`write:${table}`);
      return q;
    };
    q.single = async () => result(true);
    q.maybeSingle = async () => result(true);
    q.then = (resolve: (v: unknown) => void) => resolve(result(false));
    return q;
  };
  const admin = {
    from,
    rpc: async () => {
      log.push("commit");
      return { data: 1, error: null };
    },
  } as unknown as AdminClient;
  return { admin, log };
}

const app = {
  id: "app-1",
  status: "offer_pending_approval" as const,
  campus_id: "potch_south",
  grade_id: "toddlers",
  intake_id: "term-3-2026",
  start_month: "2026-11-01",
  next_action: null,
  child_first_name: "Nadia",
  requires_assessment: false,
};
const base = {
  campuses: [{ id: "potch_south", intake_cadence: "month" }],
  intakes: [{ id: "term-3-2026", academic_year_id: "y2026", starts_on: "2026-09-07" }],
  grades: [{ id: "toddlers", sort_order: 2 }],
  applications: [{ id: "app-1", status: "offer_pending_approval", child_first_name: "Nadia", requires_assessment: false }],
};
const letter = (start_date: string) => ({ id: "offer-1", application_id: "app-1", status: "pending_approval", conditions: null, promotion_id: null, start_date, fee_schedule_id: "s" });

beforeEach(() => {
  drafted.mockClear();
  withdrawn.mockClear();
});

describe("onStartMonthChanged", () => {
  it("does nothing when the month is saved and the letter was priced for it", async () => {
    const { admin, log } = stub({ ...base, offers: [letter("2026-11-02")] });
    expect(await onStartMonthChanged(admin, app, "2026-11-01", SYSTEM_ACTOR, { mayReprice: true })).toEqual({ reissued: false });
    expect(log).toEqual([]);
    expect(drafted).not.toHaveBeenCalled();
  });

  it("does not count a letter that names the 1st of a weekend month as out of date", async () => {
    // Drafted before `firstSchoolDay`: 1 November 2026 is a Sunday.
    const { admin } = stub({ ...base, offers: [letter("2026-11-01")] });
    expect(await onStartMonthChanged(admin, app, "2026-11-01", SYSTEM_ACTOR, { mayReprice: true })).toEqual({ reissued: false });
  });

  it("finishes a re-price that failed after the month was saved, without saving the month again", async () => {
    const { admin, log } = stub({ ...base, offers: [letter("2027-01-01")] });
    expect(await onStartMonthChanged(admin, app, "2026-11-01", SYSTEM_ACTOR, { mayReprice: true })).toEqual({ reissued: true });
    expect(drafted).toHaveBeenCalledTimes(1);
    // No new month, no second "Starting month" line on the timeline.
    expect(log).toEqual([]);
  });

  it("leaves that re-price to someone who approves offers", async () => {
    const { admin } = stub({ ...base, offers: [letter("2027-01-01")] });
    await expect(onStartMonthChanged(admin, app, "2026-11-01", SYSTEM_ACTOR, { mayReprice: false })).rejects.toThrow(/approves offers/);
    expect(drafted).not.toHaveBeenCalled();
  });
});
