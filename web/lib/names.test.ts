import { describe, expect, it } from "vitest";
import { foldName } from "@/lib/names";

describe("folding a name for comparison", () => {
  it("sets case, accents, punctuation and spacing aside", () => {
    expect(foldName("  Kágo  Moeti-Smith ")).toBe(foldName("kago moeti smith"));
    expect(foldName("COETZER")).toBe("coetzer");
  });

  it("treats a precomposed and a decomposed letter as one", () => {
    expect(foldName("José")).toBe(foldName("José"));
    expect(foldName("й")).toBe(foldName("й"));
  });

  it("keeps letters that are not Latin, so different names stay different", () => {
    expect(foldName("王")).not.toBe(foldName("李"));
    expect(foldName("Li 伟")).not.toBe(foldName("Li 娜"));
    expect(foldName("王")).not.toBe("");
  });

  it("is empty for nothing at all", () => {
    expect(foldName(null)).toBe("");
    expect(foldName(" - ")).toBe("");
  });
});
