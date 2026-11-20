import { describe, expect, it } from "vitest";
import { searchTerm } from "./data";

describe("searchTerm", () => {
  it("keeps ordinary words", () => {
    expect(searchTerm("  extension   lead ")).toBe("extension lead");
  });

  it("turns filter syntax into single-character wildcards, so the name still matches", () => {
    expect(searchTerm("O'Brien")).toBe("O_Brien");
    expect(searchTerm("A4 (80gsm)")).toBe("A4 _80gsm_");
    expect(searchTerm("a,b.c*d%e\\f:g\"h")).toBe("a_b_c_d_e_f_g_h");
  });

  it("is nothing when there is nothing to search for", () => {
    expect(searchTerm(undefined)).toBeNull();
    expect(searchTerm("   ")).toBeNull();
    expect(searchTerm("(),.")).toBeNull();
  });

  it("uses the first of a repeated ?q=", () => {
    expect(searchTerm(["drill", "saw"])).toBe("drill");
  });

  it("is never longer than 60 characters", () => {
    expect(searchTerm("x".repeat(200))?.length).toBe(60);
  });
});
