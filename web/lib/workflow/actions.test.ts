import { describe, expect, it } from "vitest";
import type { AdminClient } from "@/lib/supabase/admin";
import { onDeferralEnded, onDeferred, onWithdrawn } from "@/lib/workflow/actions";
import { SYSTEM_ACTOR, WorkflowError } from "@/lib/workflow/engine";

/**
 * Partial success must not be recorded as completion.
 *
 * These three actions clean up an application's live records and then commit
 * the new status. They used to await the cleanup updates and drop every
 * result, so a failed booking cancellation left a family holding a seat
 * another family could have had, under an application whose status read as
 * `withdrawn` — invisible for ever, because nobody looks at a finished
 * application and no sweep catches it. CodeRabbit found it on #122.
 *
 * So the assertion that matters in almost every test below is
 * `commits() === 0`: `commit_transition` is the only writer of
 * `applications.status`, so if it never ran, the status is untouched and the
 * whole operation can be retried.
 */

/** The reference the person at the screen reads back to us on the telephone. */
const REFERENCE = "HBS-2026-00072";

const app = { id: "app-1", status: "awaiting_decision" as const, reference: REFERENCE };

/**
 * A Supabase double, in the shape of the two hand-rolled ones already here
 * (`lib/settings.test.ts`, `lib/crm/segments.test.ts`) — no mocking library is
 * used anywhere in this repository. Two things those two do not need and this
 * does: every link in the chain is awaitable, and the answer depends on which
 * table was asked for, so one update can fail while the rest succeed.
 */
type Chain = {
  update: () => Chain;
  select: () => Chain;
  eq: () => Chain;
  in: () => Chain;
  then: (resolve: (value: unknown) => void) => void;
};

function stub(failOn?: { table: string; message: string }) {
  const writes: string[] = [];
  let commits = 0;

  const answer = (table: string) => ({
    data: [],
    count: 0,
    error: failOn?.table === table ? { message: failOn.message, details: "", hint: "", code: "XX000" } : null,
  });

  const from = (table: string): Chain => {
    const q: Chain = {
      update: () => (writes.push(table), q),
      select: () => q,
      eq: () => q,
      in: () => q,
      then: (resolve) => resolve(answer(table)),
    };
    return q;
  };

  const admin = {
    from,
    rpc: async () => {
      commits += 1;
      return { data: 1, error: null };
    },
  } as unknown as AdminClient;

  return { admin, writes, commits: () => commits };
}

/** Each cleanup step, and the words the staff member is shown when it fails. */
const CLEANUP = [
  ["bookings", "cancel its bookings"],
  ["attempts", "abandon its assessment attempt"],
  ["offers", "withdraw its offer"],
  ["payment_requests", "close its payment requests"],
  ["payments", "expire its unpaid checkout"],
  ["tasks", "close its open tasks"],
] as const;

describe("onWithdrawn", () => {
  it("does not record a withdrawal when the booking cancellation fails", async () => {
    const s = stub({ table: "bookings", message: "could not reach the database" });

    await expect(onWithdrawn(s.admin, app, "Chose another school", SYSTEM_ACTOR, "another_school")).rejects.toThrow(WorkflowError);

    // The seat is still held, so the application must not read as finished.
    expect(s.commits()).toBe(0);
    expect(s.writes).not.toContain("applications");
  });

  it("names the step and the application, for the person at the screen", async () => {
    const s = stub({ table: "bookings", message: "connection reset" });

    const error = await onWithdrawn(s.admin, app, null, SYSTEM_ACTOR, null).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(WorkflowError);
    // `guarded()` shows a WorkflowError's message verbatim, so it is screen copy.
    expect((error as WorkflowError).code).toBe("database");
    expect((error as WorkflowError).message).toContain(REFERENCE);
    expect((error as WorkflowError).message).toContain("cancel its bookings");
    expect((error as WorkflowError).message).toContain("connection reset");
  });

  for (const [table, step] of CLEANUP) {
    it(`stops before the commit when ${table} fails`, async () => {
      const s = stub({ table, message: "no" });

      const error = await onWithdrawn(s.admin, app, null, SYSTEM_ACTOR, null).catch((e: unknown) => e);

      expect((error as WorkflowError).message).toContain(step);
      expect(s.commits()).toBe(0);
      expect(s.writes).not.toContain("applications");
    });
  }

  it("cleans up all six, then commits, when nothing fails", async () => {
    const s = stub();

    await onWithdrawn(s.admin, app, "Moving away", SYSTEM_ACTOR, "moving_away");

    expect(s.writes).toEqual(["bookings", "attempts", "offers", "payment_requests", "payments", "tasks", "applications"]);
    expect(s.commits()).toBe(1);
  });
});

describe("onDeferred", () => {
  const deferring = { ...app, child_first_name: "Naledi", owner_staff_id: null };

  it("does not record a deferral, or a date, when the booking cancellation fails", async () => {
    const s = stub({ table: "bookings", message: "could not reach the database" });

    await expect(onDeferred(s.admin, deferring, { until: "2027-01-15", reason: null }, SYSTEM_ACTOR)).rejects.toThrow(WorkflowError);

    expect(s.commits()).toBe(0);
    // The cancel runs first precisely so no `deferred_until` is left behind on
    // an application that is still live.
    expect(s.writes).not.toContain("applications");
  });

  it("commits when the cancellation succeeds", async () => {
    const s = stub();

    await onDeferred(s.admin, deferring, { until: "2027-01-15", reason: "Moving house" }, SYSTEM_ACTOR);

    expect(s.writes).toEqual(["bookings", "applications"]);
    expect(s.commits()).toBe(1);
  });
});

describe("onDeferralEnded", () => {
  const resuming = { id: "app-1", status: "deferred" as const, reference: REFERENCE, requires_assessment: true };

  it("refuses to resume when it cannot tell whether the child has sat", async () => {
    // The nastiest of the three: a failed count reads as none, and the child
    // would resume as though they had never sat the assessment. That is a
    // wrong status, not a missing cleanup.
    const s = stub({ table: "attempts", message: "statement timeout" });

    const error = await onDeferralEnded(s.admin, resuming, SYSTEM_ACTOR).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(WorkflowError);
    expect((error as WorkflowError).message).toContain(REFERENCE);
    expect(s.commits()).toBe(0);
  });

  it("commits when the count can be read", async () => {
    const s = stub();

    await onDeferralEnded(s.admin, resuming, SYSTEM_ACTOR);

    expect(s.commits()).toBe(1);
  });
});
