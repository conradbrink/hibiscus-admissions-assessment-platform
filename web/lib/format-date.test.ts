import { describe, expect, it } from "vitest";
import { formatDateRange, formatDayMonth } from "@/lib/format-date";

describe("date ranges", () => {
  it("writes the year once when the range sits inside one", () => {
    expect(formatDateRange("2026-07-15", "2026-10-13")).toBe("15 Jul to 13 Oct 2026");
  });

  it("writes both years when the range crosses one", () => {
    expect(formatDateRange("2025-12-20", "2026-01-13")).toBe("20 Dec 2025 to 13 Jan 2026");
  });

  it("names a day without its year", () => {
    expect(formatDayMonth("2026-07-13")).toBe("13 Jul");
    expect(formatDayMonth(null)).toBe("—");
  });
});
