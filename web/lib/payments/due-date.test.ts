import { describe, expect, it } from "vitest";
import { endOfSchoolDay } from "@/lib/format-date";
import { reminderDaysFromKey, rescheduleForDueDate } from "./due-date";

const NOW = new Date("2026-10-07T12:00:00Z");
const DAY = 86_400_000;

const overdue = { id: "j-overdue", type: "payment_overdue", idempotency_key: "payment_overdue:req-1" };
const reminder = (days: number, id = `j-${days}`) => ({
  id,
  type: "send_email",
  idempotency_key: `email:app-1:payment_reminder:req-1:${days}d`,
});

describe("reminderDaysFromKey", () => {
  it("reads the days a reminder key encodes", () => {
    expect(reminderDaysFromKey("email:app-1:payment_reminder:req-1:7d")).toBe(7);
    expect(reminderDaysFromKey("email:app-1:payment_reminder:req-1:2d")).toBe(2);
  });

  it("is null for anything that is not a payment reminder", () => {
    // The drain queues plenty of other mail against an application, and a
    // deadline move must not reschedule the offer reminders or the receipt.
    expect(reminderDaysFromKey("email:app-1:offer_reminder:offer-1:7d")).toBeNull();
    expect(reminderDaysFromKey("email:app-1:offer_accepted_pay:req-1")).toBeNull();
    expect(reminderDaysFromKey("payment_overdue:req-1")).toBeNull();
    expect(reminderDaysFromKey("email:app-1:payment_reminder:req-1:0d")).toBeNull();
  });
});

describe("rescheduleForDueDate", () => {
  it("puts the overdue sweep a minute after the new deadline", () => {
    const newDue = new Date("2026-11-01T21:59:59Z");
    const [move] = rescheduleForDueDate([overdue], newDue, NOW);
    expect(move).toEqual({ id: "j-overdue", action: "reschedule", runAfter: "2026-11-01T22:00:59.000Z" });
  });

  it("puts each reminder its own number of days before the new deadline", () => {
    const newDue = new Date("2026-11-01T21:59:59Z");
    const moves = rescheduleForDueDate([reminder(7), reminder(2)], newDue, NOW);
    expect(moves).toEqual([
      { id: "j-7", action: "reschedule", runAfter: new Date(newDue.getTime() - 7 * DAY).toISOString() },
      { id: "j-2", action: "reschedule", runAfter: new Date(newDue.getTime() - 2 * DAY).toISOString() },
    ]);
  });

  it("skips a reminder whose new time has already passed", () => {
    // The deadline moved closer than the reminder's lead time. Sending "two
    // days to go" today, beside the message saying the date changed, is noise.
    const newDue = new Date(NOW.getTime() + 1 * DAY);
    const moves = rescheduleForDueDate([reminder(7), reminder(2)], newDue, NOW);
    expect(moves.map((m) => m.action)).toEqual(["skip", "skip"]);
  });

  it("skips a reminder landing inside the next quarter of an hour", () => {
    // The same fifteen minutes the queueing code refuses to create inside. A
    // reminder it would not have made is one this will not keep.
    const newDue = new Date(NOW.getTime() + 2 * DAY + 10 * 60_000);
    const [move] = rescheduleForDueDate([reminder(2)], newDue, NOW);
    expect(move.action).toBe("skip");
  });

  it("runs the overdue sweep at once when the deadline is moved into the past", () => {
    // Shortening a deadline past today is how staff mark a family late on
    // purpose; a sweep dated in the past is one the drain picks up now.
    const newDue = new Date(NOW.getTime() - 3 * DAY);
    const [move] = rescheduleForDueDate([overdue], newDue, NOW);
    expect(move.action).toBe("reschedule");
    if (move.action !== "reschedule") throw new Error("unreachable");
    expect(new Date(move.runAfter).getTime()).toBeLessThan(NOW.getTime());
  });

  it("leaves jobs it does not recognise alone", () => {
    const other = { id: "j-other", type: "send_email", idempotency_key: "email:app-1:what_to_expect:book-1" };
    expect(rescheduleForDueDate([other], new Date("2026-11-01T00:00:00Z"), NOW)).toEqual([]);
  });
});

describe("endOfSchoolDay", () => {
  it("is the last second of that day in Gaborone, not of the UTC day", () => {
    // 23:59:59+02:00 is 21:59:59Z. Taking midnight UTC instead would make a
    // deadline expire at 02:00 local on the morning of the day it names.
    expect(endOfSchoolDay("2026-11-15").toISOString()).toBe("2026-11-15T21:59:59.000Z");
  });
});
