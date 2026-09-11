import { describe, expect, it } from "vitest";
import {
  applicableSteps,
  isOverdue,
  isSettled,
  onboardingProgress,
  outstandingRequired,
  parentChecklist,
  type ItemLike,
  type StepLike,
} from "@/lib/onboarding/progress";

const step = (o: Partial<StepLike> & Pick<StepLike, "code">): StepLike => ({
  owner: "parent",
  required: true,
  is_active: true,
  campus_id: null,
  grade_sort_min: null,
  grade_sort_max: null,
  sort_order: 0,
  ...o,
});

const item = (o: Partial<ItemLike> & Pick<ItemLike, "step_code">): ItemLike => ({
  status: "pending",
  due_on: null,
  ...o,
});

describe("which steps a child gets", () => {
  const steps = [
    step({ code: "everyone", sort_order: 10 }),
    step({ code: "block7_only", campus_id: "block7", sort_order: 20 }),
    step({ code: "seniors", grade_sort_min: 60, sort_order: 30 }),
    step({ code: "juniors", grade_sort_max: 50, sort_order: 40 }),
    step({ code: "retired", is_active: false, sort_order: 50 }),
  ];
  const codes = (campusId: string, gradeSort: number | null) =>
    applicableSteps(steps, { campusId, gradeSort }).map((s) => s.code);

  it("gives a senior at Block 7 the campus and the band steps", () => {
    expect(codes("block7", 70)).toEqual(["everyone", "block7_only", "seniors"]);
  });

  it("does not give another campus's step to another campus", () => {
    expect(codes("village", 70)).toEqual(["everyone", "seniors"]);
  });

  it("picks the junior band for a junior", () => {
    expect(codes("village", 30)).toEqual(["everyone", "juniors"]);
  });

  it("gives a child with no class only what applies to everyone", () => {
    // Placement can lag enrolment. A banded step would otherwise be opened
    // and then be wrong once the class is decided.
    expect(codes("village", null)).toEqual(["everyone"]);
  });

  it("never gives a retired step", () => {
    expect(codes("block7", 70)).not.toContain("retired");
  });

  it("returns them in the school's order", () => {
    const shuffled = [step({ code: "b", sort_order: 20 }), step({ code: "a", sort_order: 10 })];
    expect(applicableSteps(shuffled, { campusId: "x", gradeSort: null }).map((s) => s.code)).toEqual(["a", "b"]);
  });
});

describe("settled and overdue", () => {
  it("counts done and not applicable as settled", () => {
    expect(isSettled(item({ step_code: "a", status: "done" }))).toBe(true);
    expect(isSettled(item({ step_code: "a", status: "not_applicable" }))).toBe(true);
    expect(isSettled(item({ step_code: "a", status: "blocked" }))).toBe(false);
    expect(isSettled(item({ step_code: "a", status: "pending" }))).toBe(false);
  });

  it("is overdue past its date and not before", () => {
    const i = item({ step_code: "a", due_on: "2026-09-10" });
    expect(isOverdue(i, "2026-09-10")).toBe(false);
    expect(isOverdue(i, "2026-09-11")).toBe(true);
  });

  it("counts a blocked item as overdue", () => {
    // The school's problem rather than the family's, but still a thing that
    // has not happened by the day it needed to.
    const i = item({ step_code: "a", status: "blocked", due_on: "2026-09-01" });
    expect(isOverdue(i, "2026-09-11")).toBe(true);
  });

  it("never calls a settled item overdue", () => {
    expect(isOverdue(item({ step_code: "a", status: "done", due_on: "2026-01-01" }), "2026-09-11")).toBe(false);
  });

  it("has no opinion without a date", () => {
    expect(isOverdue(item({ step_code: "a" }), "2026-09-11")).toBe(false);
  });
});

describe("progress", () => {
  const steps = [
    step({ code: "a", required: true, sort_order: 10 }),
    step({ code: "b", required: true, sort_order: 20 }),
    step({ code: "extra", required: false, sort_order: 30 }),
  ];

  it("measures required steps only", () => {
    // An optional extra left undone must never make a family look incomplete.
    const p = onboardingProgress(
      steps,
      [item({ step_code: "a", status: "done" }), item({ step_code: "b", status: "done" }), item({ step_code: "extra" })],
      "2026-09-11"
    );
    expect(p.requiredTotal).toBe(2);
    expect(p.requiredDone).toBe(2);
    expect(p.percent).toBe(100);
    expect(p.complete).toBe(true);
    // Still listed as outstanding, because it is: it is just not blocking.
    expect(p.outstanding).toEqual(["extra"]);
  });

  it("counts a waived step as done", () => {
    const p = onboardingProgress(
      steps,
      [item({ step_code: "a", status: "not_applicable" }), item({ step_code: "b" })],
      "2026-09-11"
    );
    expect(p.requiredDone).toBe(1);
    expect(p.percent).toBe(50);
  });

  it("is 100 per cent, not NaN, when nothing is required", () => {
    const p = onboardingProgress([step({ code: "extra", required: false })], [item({ step_code: "extra" })], "2026-09-11");
    expect(p.percent).toBe(100);
    expect(p.complete).toBe(true);
  });

  it("names what is overdue and what is blocked", () => {
    const p = onboardingProgress(
      steps,
      [
        item({ step_code: "a", due_on: "2026-09-01" }),
        item({ step_code: "b", status: "blocked", due_on: "2026-09-01" }),
      ],
      "2026-09-11"
    );
    expect(p.overdue).toEqual(["a", "b"]);
    expect(p.blocked).toEqual(["b"]);
  });

  it("lists what is outstanding in the school's order", () => {
    const p = onboardingProgress(steps, [item({ step_code: "extra" }), item({ step_code: "a" })], "2026-09-11");
    expect(p.outstanding).toEqual(["a", "extra"]);
  });
});

describe("the parent's own list", () => {
  const steps = [
    step({ code: "theirs", owner: "parent", sort_order: 10 }),
    step({ code: "ours", owner: "staff", sort_order: 20 }),
    step({ code: "either", owner: "either", sort_order: 30 }),
  ];

  it("hides the school's own steps", () => {
    // "Allocate the class" is the school's promise, not a chore to hand a
    // parent who cannot do it.
    const list = parentChecklist(steps, [item({ step_code: "theirs" }), item({ step_code: "ours" }), item({ step_code: "either" })]);
    expect(list.map((i) => i.step_code)).toEqual(["theirs", "either"]);
  });

  it("puts what is still to do above what is finished", () => {
    const list = parentChecklist(steps, [
      item({ step_code: "theirs", status: "done" }),
      item({ step_code: "either" }),
    ]);
    expect(list.map((i) => i.step_code)).toEqual(["either", "theirs"]);
  });
});

describe("outstandingRequired", () => {
  const steps: StepLike[] = [
    { code: "uniform", owner: "parent", required: true, is_active: true, campus_id: null, grade_sort_min: null, grade_sort_max: null, sort_order: 10 },
    { code: "book_pack", owner: "parent", required: false, is_active: true, campus_id: null, grade_sort_min: null, grade_sort_max: null, sort_order: 20 },
    { code: "medical", owner: "parent", required: true, is_active: true, campus_id: null, grade_sort_min: null, grade_sort_max: null, sort_order: 5 },
    { code: "allocate", owner: "staff", required: true, is_active: true, campus_id: null, grade_sort_min: null, grade_sort_max: null, sort_order: 30 },
  ];
  const item = (step_code: string, status: ItemLike["status"]): ItemLike => ({ step_code, status, due_on: null });

  it("returns required parent steps that are not settled, in the school's order", () => {
    const out = outstandingRequired(steps, [item("uniform", "pending"), item("medical", "pending")]);
    expect(out.map((i) => i.step_code)).toEqual(["medical", "uniform"]);
  });

  it("never chases an optional extra", () => {
    // A family who has not ordered a book pack has not failed to do anything.
    expect(outstandingRequired(steps, [item("book_pack", "pending")])).toEqual([]);
  });

  it("never chases a family about the school's own work", () => {
    expect(outstandingRequired(steps, [item("allocate", "pending")])).toEqual([]);
  });

  it("treats done and not-applicable as finished", () => {
    expect(outstandingRequired(steps, [item("uniform", "done"), item("medical", "not_applicable")])).toEqual([]);
  });

  it("still counts a blocked item, because it has not happened", () => {
    expect(outstandingRequired(steps, [item("uniform", "blocked")]).map((i) => i.step_code)).toEqual(["uniform"]);
  });

  it("ignores an item whose step no longer exists", () => {
    expect(outstandingRequired(steps, [item("deleted_step", "pending")])).toEqual([]);
  });
});
