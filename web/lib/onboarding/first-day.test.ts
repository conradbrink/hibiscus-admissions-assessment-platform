import { describe, expect, it } from "vitest";
import { firstDayDetails, firstDayDueAt, firstDayTitle, hasMedicalNote, type Starter } from "@/lib/onboarding/first-day";

const child = (over: Partial<Starter> = {}): Starter => ({
  id: "s1",
  firstName: "Jeremy",
  lastName: "Chigome",
  gradeName: "Stage 4",
  hasMedicalNote: false,
  ...over,
});

describe("firstDayDueAt", () => {
  it("is the campus's arrival time on the start date, at +02:00", () => {
    expect(firstDayDueAt("2027-01-12", "07:30:00")).toBe("2027-01-12T05:30:00.000Z");
  });

  it("falls back to seven when the campus has not set one", () => {
    expect(firstDayDueAt("2027-01-12", null)).toBe("2027-01-12T05:00:00.000Z");
  });

  it("takes a time without seconds, which is how a form sends it", () => {
    expect(firstDayDueAt("2027-01-12", "07:30")).toBe("2027-01-12T05:30:00.000Z");
  });

  it("is the same value every time, which is what the unique index relies on", () => {
    expect(firstDayDueAt("2027-01-12", "07:30:00")).toBe(firstDayDueAt("2027-01-12", "07:30:00"));
  });

  it("refuses to be confused by nonsense in the column", () => {
    expect(firstDayDueAt("2027-01-12", "not a time")).toBe("2027-01-12T05:00:00.000Z");
  });
});

describe("firstDayTitle", () => {
  it("counts, and says one rather than 1", () => {
    expect(firstDayTitle("Block 7", [child()])).toBe("Block 7: one new starter today");
    expect(firstDayTitle("Block 7", [child(), child({ id: "s2" })])).toBe("Block 7: 2 new starters today");
  });
});

describe("firstDayDetails", () => {
  it("names each child with their grade", () => {
    const body = firstDayDetails([child(), child({ id: "s2", firstName: "Amo", lastName: "Mokgosi", gradeName: "Stage 2" })]);
    expect(body).toContain("· Jeremy Chigome — Stage 4");
    expect(body).toContain("· Amo Mokgosi — Stage 2");
  });

  it("says nothing about medical records when none carry anything", () => {
    expect(firstDayDetails([child()])).not.toMatch(/medical/i);
  });

  it("names who has a note but never what it says", () => {
    // The task is campus-wide and outlives being ticked. Copying allergies
    // into it would put a child's medical facts in a second place with a
    // second lifetime, to save one click.
    const body = firstDayDetails([child({ hasMedicalNote: true }), child({ id: "s2", firstName: "Amo", lastName: "Mokgosi" })]);
    expect(body).toContain("Jeremy Chigome has something on their medical record");
    expect(body).not.toContain("Amo Mokgosi has something");
  });

  it("lists several without repeating the sentence", () => {
    const body = firstDayDetails([
      child({ hasMedicalNote: true }),
      child({ id: "s2", firstName: "Amo", lastName: "Mokgosi", hasMedicalNote: true }),
    ]);
    expect(body).toContain("Jeremy Chigome, Amo Mokgosi");
    expect(body.match(/medical record/g)).toHaveLength(1);
  });

  it("copes with a child who has no grade yet", () => {
    expect(firstDayDetails([child({ gradeName: null })])).toContain("· Jeremy Chigome\n");
  });
});

describe("hasMedicalNote", () => {
  const blank = { allergies: null, medical_conditions: null, medication: null, medical_notes: null };

  it("is false for an empty record", () => {
    expect(hasMedicalNote(blank)).toBe(false);
  });

  it("is false for whitespace, which is what an emptied form leaves behind", () => {
    expect(hasMedicalNote({ ...blank, allergies: "   " })).toBe(false);
  });

  it("is true for any one of the four", () => {
    expect(hasMedicalNote({ ...blank, allergies: "peanuts" })).toBe(true);
    expect(hasMedicalNote({ ...blank, medication: "inhaler" })).toBe(true);
    expect(hasMedicalNote({ ...blank, medical_conditions: "asthma" })).toBe(true);
    expect(hasMedicalNote({ ...blank, medical_notes: "tires easily" })).toBe(true);
  });
});
