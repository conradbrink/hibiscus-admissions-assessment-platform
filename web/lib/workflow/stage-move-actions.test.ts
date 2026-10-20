import { describe, expect, it } from "vitest";
import type { AdminClient } from "@/lib/supabase/admin";
import type { ApplicationStatus } from "@/lib/supabase/types";
import { SYSTEM_ACTOR, WorkflowError } from "@/lib/workflow/engine";
import { onDeferredAfterDecision } from "@/lib/workflow/stage-move-actions";

/**
 * Deferring from the offer stage (the school's request of 20 October 2026)
 * is the move back to Decision and then the ordinary deferral. What matters
 * is the order: the status moves back first, so a parent accepting in the
 * same second is refused by status, and only then is the letter withdrawn and
 * the family paused.
 *
 * A Supabase double in the shape of `actions.test.ts`'s, as a proxy because
 * these paths chain more of the query builder. Every write and every commit
 * is logged in order.
 */
function stub(rows: Record<string, unknown>, failOn?: string) {
  const log: string[] = [];
  const from = (table: string): unknown => {
    let writing = false;
    const q: unknown = new Proxy(
      {},
      {
        get(_, prop) {
          if (prop === "then") {
            return (resolve: (value: unknown) => void) =>
              resolve({
                data: rows[table] ?? [],
                count: 0,
                error: writing && failOn === table ? { message: "no", details: "", hint: "", code: "XX000" } : null,
              });
          }
          return () => {
            if (prop === "update" || prop === "upsert") {
              writing = true;
              log.push(`write:${table}`);
            }
            return q;
          };
        },
      }
    );
    return q;
  };
  const admin = {
    from,
    rpc: async (_fn: string, args: { p_new_status?: string | null }) => {
      log.push(`commit:${args?.p_new_status ?? "event"}`);
      return { data: 1, error: null };
    },
  } as unknown as AdminClient;
  return { admin, log };
}

const app = (status: ApplicationStatus) => ({
  id: "app-1",
  status,
  reference: "HBS-2026-00072",
  child_first_name: "Kobamelo",
  requires_assessment: false,
  owner_staff_id: null,
});

// Where the move back leaves them, as the reload after it reads.
const atDecision = { applications: app("awaiting_decision"), offers: [{ id: "offer-1" }] };
const spec = { until: "2027-01-15", reason: "Starting next year instead" };

describe("onDeferredAfterDecision", () => {
  it("moves back to Decision first, withdraws the letter, then defers", async () => {
    const s = stub(atDecision);

    await onDeferredAfterDecision(s.admin, app("offer_pending_approval"), spec, SYSTEM_ACTOR);

    expect(s.log).toEqual([
      // The move back, status first.
      "commit:awaiting_decision",
      "write:offers",
      "commit:event", // the letter's `offer.withdrawn` line
      "write:payment_requests",
      "write:payments",
      "write:jobs",
      // Then the deferral from Decision.
      "write:bookings",
      "write:applications",
      "commit:deferred",
    ]);
  });

  it("refuses a family past the offer before writing anything", async () => {
    const s = stub(atDecision);

    const error = await onDeferredAfterDecision(s.admin, app("offer_accepted"), spec, SYSTEM_ACTOR).catch((e: unknown) => e);

    expect((error as WorkflowError).code).toBe("status_conflict");
    expect(s.log).toEqual([]);
  });

  it("says the child is at Decision when the deferral fails after the move back", async () => {
    const s = stub(atDecision, "bookings");

    const error = await onDeferredAfterDecision(s.admin, app("offer_sent"), spec, SYSTEM_ACTOR).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(WorkflowError);
    expect((error as WorkflowError).message).toContain("moved back to Decision");
    expect((error as WorkflowError).message).toContain("Defer them again");
    expect(s.log).not.toContain("commit:deferred");
  });
});
