import { describe, expect, it } from "vitest";
import { reminderDaysFromKey, reminderJobs, reminderKey } from "@/lib/workflow/reminder-jobs";

/**
 * The reminder keys are written in one place and read back in another (a
 * moved payment deadline reschedules its reminders by the days in the key).
 * When the two disagreed, a moved deadline's reminders went out on the old
 * schedule; these hold them to the same shape.
 */

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-22T12:00:00Z");
const deadline = new Date("2026-12-05T21:59:59Z");

describe("reminder keys", () => {
  it("reads back the days from every key it writes, with or without a move's suffix", () => {
    for (const suffix of [undefined, "2026-12-05", "2026-12-05:1761134400000"]) {
      const key = reminderKey("app-1", "payment_reminder", "req-1", 7, suffix);
      expect(reminderDaysFromKey(key, "payment_reminder")).toBe(7);
    }
  });

  it("keeps the key an approval or acceptance has always written", () => {
    // Jobs already in the outbox carry these; a new shape would queue twins.
    expect(reminderKey("app-1", "offer_reminder", "offer-1", 2)).toBe("email:app-1:offer_reminder:offer-1:2d");
  });

  it("does not read one kind of reminder as the other", () => {
    expect(reminderDaysFromKey(reminderKey("app-1", "offer_reminder", "offer-1", 7), "payment_reminder")).toBeNull();
    expect(reminderDaysFromKey("payment_overdue:req-1", "payment_reminder")).toBeNull();
  });
});

describe("reminderJobs", () => {
  it("queues one per lead time, each that many days before the deadline", () => {
    const jobs = reminderJobs({ applicationId: "app-1", template: "offer_reminder", subjectId: "offer-1", deadline, daysBefore: [7, 2], payload: { offer_id: "offer-1" }, precondition: {}, now: NOW });
    expect(jobs.map((j) => j.runAfter?.toISOString())).toEqual([new Date(deadline.getTime() - 7 * DAY).toISOString(), new Date(deadline.getTime() - 2 * DAY).toISOString()]);
    expect(jobs[0].payload).toEqual({ template_key: "offer_reminder", offer_id: "offer-1" });
  });

  it("drops a reminder whose time has as good as come", () => {
    const close = new Date(NOW + 3 * DAY);
    const jobs = reminderJobs({ applicationId: "app-1", template: "payment_reminder", subjectId: "req-1", deadline: close, daysBefore: [7, 2], payload: {}, precondition: {}, now: NOW });
    expect(jobs.map((j) => j.idempotencyKey)).toEqual(["email:app-1:payment_reminder:req-1:2d"]);
  });
});
