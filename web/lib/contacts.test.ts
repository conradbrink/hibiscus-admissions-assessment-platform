import { describe, expect, it } from "vitest";
import { normaliseEmail, normaliseMobile, tidyName } from "@/lib/contacts";

describe("normaliseMobile", () => {
  it("handles Botswana numbers in the shapes parents type them", () => {
    expect(normaliseMobile("71 234 567")).toBe("+26771234567");
    expect(normaliseMobile("71234567")).toBe("+26771234567");
    expect(normaliseMobile("+267 71 234 567")).toBe("+26771234567");
    expect(normaliseMobile("0026771234567")).toBe("+26771234567");
    expect(normaliseMobile("26771234567")).toBe("+26771234567");
  });
  it("handles South African numbers", () => {
    expect(normaliseMobile("082 123 4567")).toBe("+27821234567");
    expect(normaliseMobile("+27 82 123 4567")).toBe("+27821234567");
    expect(normaliseMobile("27821234567")).toBe("+27821234567");
  });
  it("returns null for shapes it cannot vouch for, and never throws", () => {
    expect(normaliseMobile("")).toBeNull();
    expect(normaliseMobile(null)).toBeNull();
    expect(normaliseMobile("call me")).toBeNull();
    expect(normaliseMobile("+1")).toBeNull();
    expect(normaliseMobile("12345")).toBeNull();
  });
});

describe("normaliseEmail and tidyName", () => {
  it("lower-cases and trims", () => {
    expect(normaliseEmail("  Sarah@Example.COM ")).toBe("sarah@example.com");
    expect(tidyName("  sarah   jane ")).toBe("sarah jane");
  });
});
