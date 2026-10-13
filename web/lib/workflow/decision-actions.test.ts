import { describe, expect, it } from "vitest";
import type { AdminClient } from "@/lib/supabase/admin";
import { isStaleConflict } from "@/lib/staff/stale-conflict";
import { onOutcomeSent, onStaffDecision } from "@/lib/workflow/decision-actions";
import { WorkflowError, type Actor } from "@/lib/workflow/engine";

/**
 * A person's decision answers a question that is still open.
 *
 * Waitlist and decline can be recorded from the applicant's page as well as
 * the review queue, so two people can answer the same child: one from the
 * queue, one from a page opened before. The second answer used to be written
 * as a second decision with a second letter to the family. It is refused
 * before anything is read or written, as the reload-and-try-again conflict.
 */

const staff: Actor = { type: "staff", id: "staff-1", label: "staff@example.org" };

/** A client that fails the test if it is touched: the refusal comes first. */
const untouched = new Proxy(
  {},
  {
    get() {
      throw new Error("the database was touched");
    },
  }
) as unknown as AdminClient;

describe("a person's decision", () => {
  it.each([
    ["waitlisted", "waitlisted"],
    ["declined", "declined"],
    ["approved", "approved"],
    ["approved", "declined"],
    // The graph allows this one; a person deciding from a stale page may not.
    ["approved", "waitlisted"],
    ["offer_sent", "declined"],
  ] as const)("refuses %s → %s as a stale page", async (status, outcome) => {
    const attempt = onStaffDecision(untouched, { id: "app-1", status, child_first_name: "Neo" }, outcome, "Seen and discussed", staff);
    await expect(attempt).rejects.toBeInstanceOf(WorkflowError);
    await attempt.catch((e: WorkflowError) => expect(isStaleConflict(e)).toBe(true));
  });

  it("lets a waitlisted child be approved or declined later", async () => {
    // Allowed moves get past the check and on to the database, which this
    // client refuses: reaching it is the point.
    for (const outcome of ["approved", "declined"] as const) {
      await expect(
        onStaffDecision(untouched, { id: "app-1", status: "waitlisted", child_first_name: "Neo" }, outcome, "A place came free", staff)
      ).rejects.toThrow("the database was touched");
    }
  });
});

/**
 * Sending a decline letter cancels the booking still ahead of the family, on
 * the school's instruction of 13 October 2026: when the letter goes, not when
 * the decision is recorded, so the family hears why before the visit goes.
 *
 * A double in the shape of the one in `actions.test.ts`: every link is
 * awaitable, and it records what was written to which table, with which
 * filters, and what the commit said.
 */
function outcomeStub(opts: { bookingsCancelled?: number; bookingsError?: string } = {}) {
  const writes: Array<{ table: string; values: unknown; filters: unknown[][] }> = [];
  const commits: Array<Record<string, unknown>> = [];

  const from = (table: string) => {
    const filters: unknown[][] = [];
    const answer = () => {
      if (table === "bookings" && opts.bookingsError) {
        return { data: null, error: { message: opts.bookingsError, details: "", hint: "", code: "XX000" } };
      }
      if (table === "bookings") return { data: Array.from({ length: opts.bookingsCancelled ?? 0 }, (_, i) => ({ id: `b${i}` })), error: null };
      return { data: [], error: null };
    };
    const q = {
      update: (values: unknown) => (writes.push({ table, values, filters }), q),
      select: () => q,
      eq: (...args: unknown[]) => (filters.push(["eq", ...args]), q),
      not: () => q,
      limit: () => q,
      then: (resolve: (value: unknown) => void) => resolve(answer()),
    };
    return q;
  };

  const admin = {
    from,
    rpc: async (_fn: string, params: Record<string, unknown>) => {
      commits.push(params);
      return { data: 1, error: null };
    },
  } as unknown as AdminClient;

  return { admin, writes, commits };
}

describe("sending an outcome letter", () => {
  it("cancels a booking still ahead of a declined family, then sends", async () => {
    const s = outcomeStub({ bookingsCancelled: 1 });
    await onOutcomeSent(s.admin, { id: "app-1", status: "declined" }, staff);

    const cancel = s.writes.find((w) => w.table === "bookings");
    expect(cancel?.values).toMatchObject({ status: "cancelled", cancel_reason: "Application declined" });
    // Only what is still booked: a visit under way or attended is history.
    expect(cancel?.filters).toContainEqual(["eq", "application_id", "app-1"]);
    expect(cancel?.filters).toContainEqual(["eq", "status", "booked"]);

    expect(s.commits).toHaveLength(1);
    expect((s.commits[0].p_event as { summary: string }).summary).toBe("Decline email sent, and their booking cancelled");
  });

  it("says nothing about a booking when there was none to cancel", async () => {
    const s = outcomeStub({ bookingsCancelled: 0 });
    await onOutcomeSent(s.admin, { id: "app-1", status: "declined" }, staff);
    expect((s.commits[0].p_event as { summary: string }).summary).toBe("Decline email sent");
  });

  it("leaves a waitlisted family's booking alone", async () => {
    const s = outcomeStub({ bookingsCancelled: 1 });
    await onOutcomeSent(s.admin, { id: "app-1", status: "waitlisted" }, staff);
    expect(s.writes.filter((w) => w.table === "bookings")).toHaveLength(0);
    expect(s.commits).toHaveLength(1);
  });

  it("sends nothing when the booking cannot be cancelled, so Send can be pressed again", async () => {
    const s = outcomeStub({ bookingsError: "connection reset" });
    const error = await onOutcomeSent(s.admin, { id: "app-1", status: "declined" }, staff).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WorkflowError);
    expect((error as WorkflowError).code).toBe("database");
    expect((error as WorkflowError).message).toContain("connection reset");
    expect(s.commits).toHaveLength(0);
  });
});
