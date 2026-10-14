import { describe, expect, it } from "vitest";
import { formatDate, formatDateRange, formatDayMonth, schoolDaysBetween } from "@/lib/format-date";

describe("date ranges", () => {
  it("writes the year once when the range sits inside one", () => {
    expect(formatDateRange("2026-07-15", "2026-10-13")).toBe("15 Jul to 13 Oct 2026");
  });

  it("writes both years when the range crosses one", () => {
    expect(formatDateRange("2025-12-20", "2026-01-13")).toBe("20 Dec 2025 to 13 Jan 2026");
  });

  it("names a day without its year", () => {
    expect(formatDayMonth("2026-07-13")).toBe("13 Jul");
    expect(formatDayMonth("2025-10-13", true)).toBe("13 Oct 2025");
    expect(formatDayMonth(null)).toBe("—");
  });

  it("names the same day wherever the server or reader is", () => {
    // Read as the host's own midnight, every date-only string was a day early
    // anywhere ahead of the school's UTC+2.
    const host = process.env.TZ;
    try {
      for (const tz of ["Asia/Tokyo", "Africa/Nairobi", "Africa/Gaborone", "UTC", "America/New_York"]) {
        process.env.TZ = tz;
        expect(formatDateRange("2026-07-15", "2026-10-13")).toBe("15 Jul to 13 Oct 2026");
        expect(formatDayMonth("2026-07-13")).toBe("13 Jul");
        expect(formatDate("2026-07-15")).toBe("15 Jul 2026");
      }
    } finally {
      if (host === undefined) delete process.env.TZ;
      else process.env.TZ = host;
    }
  });
});

describe("days between, as the school's calendar counts them", () => {
  it("counts calendar days in Gaborone, not 24-hour blocks", () => {
    const noon = new Date("2026-10-14T10:00:00Z");
    expect(schoolDaysBetween("2026-10-13T20:00:00Z", noon)).toBe(1);
    expect(schoolDaysBetween("2026-10-13T22:30:00Z", noon)).toBe(0);
    expect(schoolDaysBetween("2026-09-30T10:00:00Z", noon)).toBe(14);
    expect(schoolDaysBetween("not a date", noon)).toBeNull();
  });
});
