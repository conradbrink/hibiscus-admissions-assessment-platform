import { describe, expect, it } from "vitest";
import type { AdminClient } from "@/lib/supabase/admin";
import { isStaleConflict } from "@/lib/staff/stale-conflict";
import { onStaffDecision } from "@/lib/workflow/decision-actions";
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
