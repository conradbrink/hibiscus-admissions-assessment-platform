import { describe, expect, it } from "vitest";
import { deadlinePassed, parseDeadline } from "@/lib/booking/deadline";

describe("reading the interview deadline", () => {
  it("parses a date and refuses anything that is not one", () => {
    // `new Date("")` is an Invalid Date rather than a throw, and only blows up
    // later inside the slot filter when something asks it for an ISO string.
    expect(parseDeadline("2026-10-09")?.toISOString().slice(0, 10)).toBe("2026-10-09");
    expect(parseDeadline("")).toBeNull();
    expect(parseDeadline("not a date")).toBeNull();
    expect(parseDeadline(null)).toBeNull();
    expect(parseDeadline(undefined)).toBeNull();
  });
});

describe("whether the interview window has closed", () => {
  const deadline = parseDeadline("2026-10-09")!;

  it("is open on the deadline day itself, to the last minute in Gaborone", () => {
    // The school told families "until 09 October". A family opening the link
    // at nine that evening is inside the window, and would have been cut off
    // two hours early by a UTC midnight.
    expect(deadlinePassed(deadline, new Date("2026-10-09T05:00:00Z"))).toBe(false);
    expect(deadlinePassed(deadline, new Date("2026-10-09T21:59:00Z"))).toBe(false);
  });

  it("is closed once that day is over", () => {
    expect(deadlinePassed(deadline, new Date("2026-10-09T22:00:01Z"))).toBe(true);
    expect(deadlinePassed(deadline, new Date("2026-10-15T08:00:00Z"))).toBe(true);
  });

  it("is never closed for a family that holds no deadline", () => {
    // Holding a deadline and being past it are different questions. Conflating
    // them told a scholarship family whose campus was merely booked out that
    // interviews had closed on a date three weeks away.
    expect(deadlinePassed(null, new Date("2030-01-01T00:00:00Z"))).toBe(false);
    expect(deadlinePassed(deadline, new Date("2026-09-22T10:00:00Z"))).toBe(false);
  });
});
