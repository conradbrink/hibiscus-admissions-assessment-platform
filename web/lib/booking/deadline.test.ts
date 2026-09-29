import { describe, expect, it } from "vitest";
import { bookingWindow, deadlinePassed, parseDeadline, withinWindow } from "@/lib/booking/deadline";

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

describe("an application's own booking window", () => {
  const late = { interview_window_from: "2026-10-12", interview_window_to: "2026-10-23" };
  const setting = { scholarship: true, scholarshipDeadline: "2026-10-17" };

  it("uses the application's dates in place of the school-wide deadline", () => {
    const w = bookingWindow(late, setting);
    expect(w.notBefore?.toISOString().slice(0, 10)).toBe("2026-10-12");
    expect(w.notAfter?.toISOString().slice(0, 10)).toBe("2026-10-23");
  });

  it("falls back to the deadline for a scholarship family with no window, and to nothing for anyone else", () => {
    expect(bookingWindow({}, setting)).toEqual({ notBefore: null, notAfter: parseDeadline("2026-10-17") });
    expect(bookingWindow({ interview_window_from: null, interview_window_to: null }, { scholarship: false, scholarshipDeadline: "2026-10-17" })).toEqual({
      notBefore: null,
      notAfter: null,
    });
  });

  it("takes both first and last days whole, in Gaborone time", () => {
    const w = bookingWindow(late, setting);
    // 08:00 on the 12th and 11:00 on the 23rd, Gaborone (UTC+2).
    expect(withinWindow(new Date("2026-10-12T06:00:00Z"), w)).toBe(true);
    expect(withinWindow(new Date("2026-10-23T09:00:00Z"), w)).toBe(true);
    // The Friday before and the Monday after.
    expect(withinWindow(new Date("2026-10-09T06:00:00Z"), w)).toBe(false);
    expect(withinWindow(new Date("2026-10-26T06:00:00Z"), w)).toBe(false);
    // One minute either side of the window, in Gaborone.
    expect(withinWindow(new Date("2026-10-11T21:59:00Z"), w)).toBe(false);
    expect(withinWindow(new Date("2026-10-23T22:00:01Z"), w)).toBe(false);
  });

  it("lets anything through an open window", () => {
    expect(withinWindow(new Date("2030-01-01T00:00:00Z"), { notBefore: null, notAfter: null })).toBe(true);
  });
});
