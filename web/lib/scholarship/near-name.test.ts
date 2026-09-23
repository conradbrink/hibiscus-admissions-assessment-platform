import { describe, expect, it } from "vitest";
import { looksLikeSameChild, nameDistance } from "@/lib/scholarship/near-name";

describe("nameDistance", () => {
  it("counts the edits between two names", () => {
    expect(nameDistance("Letang", "Lerang")).toBe(1);
    expect(nameDistance("Tanyaradzwa", "Tania")).toBe(7);
    expect(nameDistance("Luba", "Realeboga")).toBe(6);
  });

  it("ignores case and surrounding space", () => {
    expect(nameDistance("  Jeremy ", "JEREMY")).toBe(0);
  });

  it("handles an empty name", () => {
    expect(nameDistance("", "Jeremy")).toBe(6);
    expect(nameDistance("Jeremy", "")).toBe(6);
    expect(nameDistance("", "")).toBe(0);
  });
});

describe("looksLikeSameChild", () => {
  it("flags the one in the real sheet", () => {
    // Letang Aki Chilume is already on file under giftwithmai@gmail.com; the
    // scholarship row says Lerang Chilume. Siblings, or one child typed twice.
    expect(looksLikeSameChild("Letang", "Lerang")).toBe(true);
  });

  it("flags a longer name two edits apart", () => {
    expect(looksLikeSameChild("Tanyaradzwa", "Tanyaradza")).toBe(true);
    expect(looksLikeSameChild("Mokgethwa", "Mokgetwa")).toBe(true);
  });

  it("does not flag an exact match, which needs no person", () => {
    // The database recognises this one by itself and returns the application
    // that already exists. A warning here would be noise.
    expect(looksLikeSameChild("Jeremy", "jeremy")).toBe(false);
  });

  it("does not flag names that are merely short and similar", () => {
    // Real different children. A one-edit rule on short names would warn about
    // half a class.
    expect(looksLikeSameChild("Ana", "Ava")).toBe(false);
    expect(looksLikeSameChild("Neo", "Teo")).toBe(false);
    expect(looksLikeSameChild("Tumi", "Tumo")).toBe(false);
  });

  it("does not flag plainly different names", () => {
    expect(looksLikeSameChild("Luba", "Realeboga")).toBe(false);
    expect(looksLikeSameChild("Tania", "Tanyaradzwa")).toBe(false);
    expect(looksLikeSameChild("Aleo Berlin", "Arona Akalo")).toBe(false);
  });

  it("says nothing about a blank", () => {
    expect(looksLikeSameChild("", "Jeremy")).toBe(false);
    expect(looksLikeSameChild("Jeremy", "")).toBe(false);
  });
});
