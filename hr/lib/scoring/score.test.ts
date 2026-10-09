import { describe, expect, it } from "vitest";
import { summariseTenure } from "@/lib/recruitment/tenure";
import { scoreApplication, type ScoreInput } from "@/lib/scoring/score";
import { DEFAULT_WEIGHTS } from "@/lib/settings";

const today = new Date("2026-10-12T10:00:00Z");

function base(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    today,
    country: "BW",
    phase: "primary",
    isCitizen: true,
    qualifications: [{ level: "degree", is_teaching: true }],
    compliance: {
      registration_body: "BTPC",
      registration_expires_on: "2027-12-31",
      needs_permit: false,
      permit_expires_on: null,
      police_clearance: "have",
      police_clearance_issued_on: "2026-08-01",
      child_protection_clear: true,
      criminal_record: false,
      dismissed_before: false,
      safeguarding_concern: false,
    },
    tenure: summariseTenure(
      [
        { start_on: "2014-01-01", end_on: "2019-01-01", is_school: true },
        { start_on: "2019-01-01", end_on: null, is_school: true },
      ],
      today
    ),
    answers: [
      { competency: "pedagogy", answered: true, aiBand: 4, humanBand: null, integrity: "low" },
      { competency: "safeguarding", answered: true, aiBand: 4, humanBand: null, integrity: "low" },
    ],
    communication: { aiBand: 4, humanBand: null },
    references: {
      requested: 2,
      outstanding: 0,
      responses: [
        {
          ratings: { teaching: 5, classroom_management: 5, reliability: 5, teamwork: 5, parent_communication: 5, professionalism: 5 },
          recommendation: "yes",
          wouldReemploy: "yes",
          concern: false,
          fromMostRecentEmployer: true,
        },
      ],
    },
    weights: DEFAULT_WEIGHTS,
    ...overrides,
  };
}

describe("scoreApplication", () => {
  it("gives a complete, excellent application 100 of 100", () => {
    const s = scoreApplication(base());
    expect(s.available).toBe(100);
    expect(s.total).toBe(100);
    expect(s.flags).toEqual([]);
  });

  it("leaves out what cannot be scored yet, and says how much is available", () => {
    const s = scoreApplication(
      base({
        answers: [{ competency: "pedagogy", answered: true, aiBand: null, humanBand: null, integrity: "unchecked" }],
        communication: { aiBand: null, humanBand: null },
        references: { requested: 2, outstanding: 2, responses: [] },
      })
    );
    expect(s.available).toBe(45); // qualifications 25 + experience 20
    expect(s.total).toBe(45);
    expect(s.sections.find((x) => x.key === "answers")?.points).toBeNull();
  });

  it("prefers a person's band to the AI's", () => {
    const s = scoreApplication(
      base({ answers: [{ competency: "pedagogy", answered: true, aiBand: 4, humanBand: 2, integrity: "low" }] })
    );
    expect(s.sections.find((x) => x.key === "answers")?.points).toBe(15);
  });

  it("counts a blank answer as zero without waiting for anyone to mark it", () => {
    const s = scoreApplication(
      base({
        answers: [
          { competency: "pedagogy", answered: true, aiBand: 4, humanBand: null, integrity: "low" },
          { competency: "assessment", answered: false, aiBand: null, humanBand: null, integrity: "low" },
        ],
      })
    );
    expect(s.sections.find((x) => x.key === "answers")?.points).toBe(15);
  });

  it("never lowers the score for a flag", () => {
    const clean = scoreApplication(base());
    const flagged = scoreApplication(
      base({
        references: {
          requested: 1,
          outstanding: 0,
          responses: [{ ...base().references.responses[0], concern: true }],
        },
        answers: base().answers.map((a) => ({ ...a, integrity: "high" as const })),
      })
    );
    expect(flagged.total).toBe(clean.total);
    expect(flagged.flags.map((f) => f.code)).toEqual(["safeguarding_reference", "possible_ai_answers"]);
    expect(flagged.flags[0].severity).toBe("critical");
  });

  it("wants SACE in South Africa and BTPC in Botswana", () => {
    const za = scoreApplication(base({ country: "ZA" }));
    expect(za.flags.map((f) => f.code)).toContain("registration_missing");
    const sace = scoreApplication(
      base({ country: "ZA", compliance: { ...base().compliance!, registration_body: "SACE" } })
    );
    expect(sace.flags.map((f) => f.code)).not.toContain("registration_missing");
  });

  it("flags an expired permit for a non-citizen", () => {
    const s = scoreApplication(
      base({ isCitizen: false, compliance: { ...base().compliance!, needs_permit: true, permit_expires_on: "2026-01-01" } })
    );
    expect(s.flags.map((f) => f.code)).toContain("permit_expired");
  });

  it("flags a weak safeguarding answer as critical", () => {
    const s = scoreApplication(
      base({ answers: [{ competency: "safeguarding", answered: true, aiBand: 1, humanBand: null, integrity: "low" }] })
    );
    expect(s.flags[0]).toMatchObject({ code: "safeguarding_answer_weak", severity: "critical" });
  });

  it("asks for a reference from the most recent employer once the rest are in", () => {
    const s = scoreApplication(
      base({
        references: {
          requested: 1,
          outstanding: 0,
          responses: [{ ...base().references.responses[0], fromMostRecentEmployer: false }],
        },
      })
    );
    expect(s.flags.map((f) => f.code)).toContain("no_recent_employer_reference");
  });

  it("rewards stability: a short average tenure scores less", () => {
    const hopper = scoreApplication(
      base({
        tenure: summariseTenure(
          [
            { start_on: "2020-01-01", end_on: "2020-09-01" },
            { start_on: "2020-09-01", end_on: "2021-06-01" },
            { start_on: "2021-06-01", end_on: "2022-03-01" },
          ],
          today
        ),
      })
    );
    const stable = scoreApplication(base());
    const exp = (r: typeof hopper) => r.sections.find((x) => x.key === "experience")!.points!;
    expect(exp(hopper)).toBeLessThan(exp(stable));
  });
});
