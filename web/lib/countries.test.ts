import { describe, expect, it } from "vitest";
import { canonicalCountry, canonicalNationality, COUNTRIES, COUNTRY_NAMES, NATIONALITIES, PRIORITY_COUNTRIES } from "@/lib/countries";

describe("countries", () => {
  it("puts the school's countries first, then the rest A to Z", () => {
    expect(COUNTRY_NAMES.slice(0, PRIORITY_COUNTRIES.length)).toEqual([...PRIORITY_COUNTRIES]);
    const rest = COUNTRY_NAMES.slice(PRIORITY_COUNTRIES.length);
    expect([...rest].sort((a, b) => a.localeCompare(b, "en"))).toEqual(rest);
  });

  it("has no duplicates and a nationality for every country", () => {
    expect(new Set(COUNTRY_NAMES).size).toBe(COUNTRIES.length);
    expect(new Set(NATIONALITIES).size).toBe(COUNTRIES.length);
    expect(COUNTRIES.length).toBeGreaterThan(190);
  });

  it("normalises what a parent types", () => {
    expect(canonicalCountry("botswana")).toBe("Botswana");
    expect(canonicalCountry(" RSA ")).toBe("South Africa");
    expect(canonicalCountry("Cote d'Ivoire")).toBe("Côte d'Ivoire");
    expect(canonicalCountry("Swaziland")).toBe("Eswatini");
    expect(canonicalCountry("Narnia")).toBeNull();
    expect(canonicalCountry("")).toBeNull();
  });

  it("understands nationalities, aliases and a country typed as a nationality", () => {
    expect(canonicalNationality("motswana")).toBe("Motswana");
    expect(canonicalNationality("Botswana")).toBe("Motswana");
    expect(canonicalNationality("Batswana")).toBe("Motswana");
    expect(canonicalNationality("south african")).toBe("South African");
    expect(canonicalNationality("UK")).toBe("British");
    expect(canonicalNationality("Martian")).toBeNull();
  });
});

describe("pick lists", () => {
  it("returns the list's spelling for a known answer and the text otherwise", async () => {
    const { canonicalFromList, LANGUAGES, MEDICAL_AIDS } = await import("@/lib/pick-lists");
    expect(canonicalFromList(LANGUAGES, "setswana")).toBe("Setswana");
    expect(canonicalFromList(LANGUAGES, "isizulu")).toBe("isiZulu");
    expect(canonicalFromList(LANGUAGES, "Klingon")).toBe("Klingon");
    expect(canonicalFromList(MEDICAL_AIDS, "bpomas")).toBe("BPOMAS (Botswana Public Officers Medical Aid Scheme)");
    expect(canonicalFromList(MEDICAL_AIDS, "  ")).toBeNull();
    expect(LANGUAGES[0]).toBe("Setswana");
    expect(new Set(LANGUAGES).size).toBe(LANGUAGES.length);
  });
});
